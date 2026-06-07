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
    status: document.getElementById("accountStatus"),
    guestActions: document.getElementById("accountGuestActions"),
    signUp: document.getElementById("signUpButton"),
    signOut: document.getElementById("signOutButton"),
    close: document.getElementById("closeAccountDialog"),
  };

  let client = null;
  let user = null;
  let enabled = false;
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
    elements.guestActions.hidden = signedIn || !enabled;
    elements.signOut.hidden = !signedIn;
    elements.status.textContent = "";

    if (signedIn) {
      elements.title.textContent = "已开启云同步";
      elements.description.textContent = user.email || "当前账户";
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

    if (changedUser) await mergeAndLoad();
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
