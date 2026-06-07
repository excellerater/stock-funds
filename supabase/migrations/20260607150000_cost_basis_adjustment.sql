alter table public.transactions
  drop constraint if exists transactions_transaction_type_check;

alter table public.transactions
  add constraint transactions_transaction_type_check
  check (
    transaction_type in ('buy', 'sell', 'dividend', 'fee', 'cost_basis')
  );
