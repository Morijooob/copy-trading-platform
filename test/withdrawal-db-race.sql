CREATE TABLE wallet_accounts (
  user_id text PRIMARY KEY,
  balance numeric NOT NULL DEFAULT 0,
  locked_balance numeric NOT NULL DEFAULT 0
);

CREATE TABLE wallet_withdrawal_requests (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  amount numeric NOT NULL,
  status text NOT NULL,
  idempotency_key text,
  UNIQUE (user_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION request_withdrawal(p_user_id text, p_amount numeric, p_key text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint;
BEGIN
  SELECT id INTO v_id
  FROM wallet_withdrawal_requests
  WHERE user_id = p_user_id AND idempotency_key = p_key;
  IF FOUND THEN RETURN v_id; END IF;

  UPDATE wallet_accounts
  SET balance = balance - p_amount,
      locked_balance = locked_balance + p_amount
  WHERE user_id = p_user_id AND balance >= p_amount;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient available balance';
  END IF;

  INSERT INTO wallet_withdrawal_requests(user_id, amount, status, idempotency_key)
  VALUES (p_user_id, p_amount, 'pending', p_key)
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_id
  FROM wallet_withdrawal_requests
  WHERE user_id = p_user_id AND idempotency_key = p_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  RAISE;
END;
$$;

INSERT INTO wallet_accounts(user_id, balance, locked_balance)
VALUES ('race-user', 1000, 0);
