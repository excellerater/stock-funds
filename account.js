(() => {
  const FAVORITES_KEY = "fund-favorites";
  const POSITIONS_KEY = "fund-positions";
  const elements = {
    mode: document.getElementById("accountMode"),
    button: document.getElementById("accountButton"),
    storageNote: document.getElementById("storageNote"),
    dialog: document.getElementById("accountDialog"),
    form: document.getElementById("accountForm"),
    title: document.getElementById("accountTitle"),
    description: document.getElementById("accountDescription"),
    fields: document.getElementById("accountFields"),
    email: document.getElementById("accountEmail"),
    password: document.getElementById("accountPassword"),
    profileFields: document.getElementById("profileFields"),
    avatarPreview: document.getElementById("avatarPreview"),
    avatarInitial: document.getElementById("avatarInitial"),
    avatarImage: document.getElementById("avatarImage"),
    avatarFile: document.getElementById("avatarFile"),
    displayName: document.getElementById("displayName"),
    saveProfile: document.getElementById("saveProfileButton"),
    newPassword: document.getElementById("newPassword"),
    updatePassword: document.getElementById("updatePasswordButton"),
    status: document.getElementById("accountStatus"),
    guestActions: document.getElementById("accountGuestActions"),
    signUp: document.getElementById("signUpButton"),
    signOut: document.getElementById("signOutButton"),
    close: document.getElementById("closeAccountDialog"),
  };

  let client = null;
  let user = null;
  let enabled = false;
  let profile = null;
  let onCloudData = () => {};
  const positionTimers = new Map();

  elements.button.addEventListener("click", openDialog);
  elements.close.addEventListener("click", () => elements.dialog.close());
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) elements.dialog.close();
  });
  elements.form.addEventListener("submit", signIn);
  elements.signUp.addEventListener("click", signUp);
  elements.signOut.addEventListener("click", signOut);
  elements.avatarFile.addEventListener("change", previewSelectedAvatar);
  elements.saveProfile.addEventListener("click", saveProfile);
  elements.updatePassword.addEventListener("click", updatePassword);

  window.accountSync = {
    init,
    saveFavorites,
    savePosition,
    isCloudEnabled: () => enabled,
    isSignedIn: () => Boolean(user),
  };

  async function init(callback) {
    onCloudData = typeof callback === "function" ? callback : onCloudData;
    setLocalMode();

    if (location.protocol === "file:") return;

    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      if (!response.ok) return;
      const config = await response.json();
      if (!config.enabled) return;

      const { createClient } = await import(
        "https://esm.sh/@supabase/supabase-js@2"
      );
      client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      enabled = true;

      const { data } = await client.auth.getSession();
      await applySession(data.session);
      client.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => applySession(session), 0);
      });
    } catch {
      setLocalMode("云同步连接失败，本机数据不受影响");
    }
  }

  function openDialog() {
    updateDialog();
    elements.dialog.showModal();
    if (enabled && !user) elements.email.focus();
  }

  function updateDialog() {
    const signedIn = Boolean(user);
    elements.fields.hidden = signedIn || !enabled;
    elements.profileFields.hidden = !signedIn;
    elements.guestActions.hidden = signedIn || !enabled;
    elements.signOut.hidden = !signedIn;
    elements.status.textContent = "";

    if (signedIn) {
      elements.title.textContent = "账户资料";
      elements.description.textContent = user.email || "当前账户";
      elements.displayName.value = profile?.display_name || "";
      renderAvatar();
      return;
    }

    elements.title.textContent = enabled ? "登录并同步" : "云同步尚未连接";
    elements.description.textContent = enabled
      ? "登录后会合并当前浏览器的自选和投入记录。"
      : "当前继续使用本机保存。配置 Supabase 后即可注册和跨设备同步。";
  }

  async function signIn(event) {
    event.preventDefault();
    if (!client) return;
    setBusy(true, "正在登录");
    const { error } = await client.auth.signInWithPassword({
      email: elements.email.value.trim(),
      password: elements.password.value,
    });
    setBusy(false, error ? humanizeError(error) : "登录成功");
    if (!error) elements.dialog.close();
  }

  async function signUp() {
    if (!client || !elements.form.reportValidity()) return;
    setBusy(true, "正在创建账户");
    const { data, error } = await client.auth.signUp({
      email: elements.email.value.trim(),
      password: elements.password.value,
    });
    const message = error
      ? humanizeError(error)
      : data.session
        ? "注册成功"
        : "注册成功，请查收验证邮件";
    setBusy(false, message);
    if (data.session) elements.dialog.close();
  }

  async function signOut() {
    if (!client) return;
    elements.signOut.disabled = true;
    await client.auth.signOut();
    elements.signOut.disabled = false;
    elements.dialog.close();
  }

  async function applySession(session) {
    const nextUser = session?.user ?? null;
    const changedUser = nextUser?.id !== user?.id;
    user = nextUser;

    if (!user) {
      setLocalMode(enabled ? "可登录同步" : "");
      return;
    }

    elements.mode.textContent = "云端同步";
    elements.mode.classList.add("cloud");
    elements.button.textContent = shortEmail(user.email);
    elements.storageNote.textContent = "已同步到你的账户";

    if (changedUser) {
      await Promise.all([mergeAndLoad(), loadProfile()]);
      updateAccountSummary();
    }
  }

  async function loadProfile() {
    if (!client || !user) return;
    const { data, error } = await client
      .from("profiles")
      .select("display_name,avatar_path")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return;
    profile = data || { display_name: "", avatar_path: null };
  }

  async function saveProfile() {
    if (!client || !user) return;
    const displayName = elements.displayName.value.trim().slice(0, 30);
    const file = elements.avatarFile.files?.[0];

    if (file && !file.type.startsWith("image/")) {
      elements.status.textContent = "请选择图片文件";
      return;
    }
    if (file && file.size > 2 * 1024 * 1024) {
      elements.status.textContent = "头像不能超过 2 MB";
      return;
    }

    setBusy(true, file ? "正在上传头像" : "正在保存资料");
    let avatarPath = profile?.avatar_path || null;

    if (file) {
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      avatarPath = `${user.id}/avatar.${extension}`;
      const { error: uploadError } = await client.storage
        .from("avatars")
        .upload(avatarPath, file, {
          upsert: true,
          contentType: file.type,
          cacheControl: "3600",
        });
      if (uploadError) {
        setBusy(false, humanizeError(uploadError));
        return;
      }
    }

    const { error } = await client.from("profiles").upsert(
      {
        user_id: user.id,
        display_name: displayName,
        avatar_path: avatarPath,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (!error) {
      profile = { display_name: displayName, avatar_path: avatarPath };
      elements.avatarFile.value = "";
      updateAccountSummary();
      renderAvatar();
    }
    setBusy(false, error ? humanizeError(error) : "资料已保存");
  }

  async function updatePassword() {
    if (!client || !user) return;
    const password = elements.newPassword.value;
    if (password.length < 6) {
      elements.status.textContent = "新密码至少需要 6 位";
      return;
    }

    setBusy(true, "正在修改密码");
    const { error } = await client.auth.updateUser({ password });
    if (!error) elements.newPassword.value = "";
    setBusy(false, error ? humanizeError(error) : "密码已修改");
  }

  function previewSelectedAvatar() {
    const file = elements.avatarFile.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    elements.avatarImage.src = URL.createObjectURL(file);
    elements.avatarImage.hidden = false;
    elements.avatarInitial.hidden = true;
  }

  function renderAvatar() {
    const name = profile?.display_name || user?.email || "账户";
    elements.avatarInitial.textContent = name.trim().charAt(0).toUpperCase() || "账";
    if (!profile?.avatar_path || !client) {
      elements.avatarImage.hidden = true;
      elements.avatarInitial.hidden = false;
      return;
    }

    const { data } = client.storage
      .from("avatars")
      .getPublicUrl(profile.avatar_path);
    elements.avatarImage.src = `${data.publicUrl}?v=${Date.now()}`;
    elements.avatarImage.hidden = false;
    elements.avatarInitial.hidden = true;
  }

  function updateAccountSummary() {
    const label = profile?.display_name?.trim() || shortEmail(user?.email);
    elements.button.textContent =
      label.length > 10 ? `${label.slice(0, 9)}…` : label;
    if (elements.dialog.open) updateDialog();
  }

  async function mergeAndLoad() {
    if (!client || !user) return;
    const localFavorites = readArray(FAVORITES_KEY).map(String);
    const localPositions = readObject(POSITIONS_KEY);

    if (localFavorites.length) {
      await client.from("user_favorites").upsert(
        localFavorites.map((fundId) => ({
          user_id: user.id,
          fund_id: fundId,
        })),
        { onConflict: "user_id,fund_id" },
      );
    }

    const positionRows = Object.entries(localPositions)
      .filter(([, amount]) => Number(amount) > 0)
      .map(([fundId, amount]) => ({
        user_id: user.id,
        fund_id: String(fundId),
        invested_amount: Number(amount),
      }));
    if (positionRows.length) {
      await client
        .from("user_positions")
        .upsert(positionRows, { onConflict: "user_id,fund_id" });
    }

    const [favoritesResult, positionsResult] = await Promise.all([
      client.from("user_favorites").select("fund_id"),
      client.from("user_positions").select("fund_id,invested_amount"),
    ]);

    if (favoritesResult.error || positionsResult.error) {
      elements.storageNote.textContent = "云端读取失败，继续使用本机数据";
      return;
    }

    const favorites = favoritesResult.data.map((row) => String(row.fund_id));
    const positions = Object.fromEntries(
      positionsResult.data.map((row) => [
        String(row.fund_id),
        Number(row.invested_amount),
      ]),
    );
    writeLocal(FAVORITES_KEY, favorites);
    writeLocal(POSITIONS_KEY, positions);
    onCloudData({ favorites, positions });
  }

  async function saveFavorites(favorites) {
    if (!client || !user) return;
    const values = [...favorites].map(String);
    const { error: deleteError } = await client
      .from("user_favorites")
      .delete()
      .eq("user_id", user.id);
    if (deleteError || !values.length) return;
    await client.from("user_favorites").insert(
      values.map((fundId) => ({
        user_id: user.id,
        fund_id: fundId,
      })),
    );
  }

  function savePosition(fundId, amount) {
    if (!client || !user) return;
    const key = String(fundId);
    clearTimeout(positionTimers.get(key));
    positionTimers.set(
      key,
      setTimeout(async () => {
        if (Number(amount) > 0) {
          await client.from("user_positions").upsert(
            {
              user_id: user.id,
              fund_id: key,
              invested_amount: Number(amount),
            },
            { onConflict: "user_id,fund_id" },
          );
        } else {
          await client
            .from("user_positions")
            .delete()
            .eq("user_id", user.id)
            .eq("fund_id", key);
        }
        positionTimers.delete(key);
      }, 500),
    );
  }

  function setLocalMode(note = "") {
    user = null;
    profile = null;
    elements.mode.textContent = "本机保存";
    elements.mode.classList.remove("cloud");
    elements.button.textContent = enabled ? "登录" : "账户";
    elements.storageNote.textContent = note || "仅保存在当前浏览器";
  }

  function setBusy(busy, message) {
    elements.form.setAttribute("aria-busy", String(busy));
    elements.form.querySelectorAll("button").forEach((button) => {
      if (button !== elements.close) button.disabled = busy;
    });
    elements.status.textContent = message;
  }

  function shortEmail(email = "") {
    const name = email.split("@")[0];
    return name.length > 10 ? `${name.slice(0, 9)}…` : name || "账户";
  }

  function humanizeError(error) {
    const message = error?.message || "操作失败";
    if (message.includes("Invalid login credentials")) return "邮箱或密码错误";
    if (message.includes("already registered")) return "这个邮箱已经注册";
    if (message.includes("rate limit")) return "操作太频繁，请稍后再试";
    return message;
  }

  function readArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function readObject(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Local persistence may be unavailable in private browsing.
    }
  }
})();
