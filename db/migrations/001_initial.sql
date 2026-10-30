CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  currency_code char(3) NOT NULL DEFAULT 'XOF' CHECK (currency_code = 'XOF'),
  timezone text NOT NULL DEFAULT 'Africa/Abidjan' CHECK (timezone = 'Africa/Abidjan'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, kind, name),
  UNIQUE (id, owner_id)
);

CREATE TABLE financial_transaction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  amount_xof bigint NOT NULL CHECK (amount_xof > 0),
  currency_code char(3) NOT NULL DEFAULT 'XOF' CHECK (currency_code = 'XOF'),
  occurred_on date NOT NULL,
  due_on date,
  payee text CHECK (payee IS NULL OR length(payee) <= 120),
  note text CHECK (note IS NULL OR length(note) <= 500),
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('planned', 'paid', 'deferred')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (category_id, owner_id) REFERENCES category(id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX financial_transaction_owner_date_idx
  ON financial_transaction (owner_id, occurred_on DESC);

CREATE INDEX financial_transaction_owner_status_due_idx
  ON financial_transaction (owner_id, status, due_on);

CREATE TABLE auth_session (
  token_hash text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_session_expiry_idx ON auth_session (expires_at);

CREATE TABLE auth_login_throttle (
  identity_hash text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_hash)
);

CREATE INDEX auth_login_throttle_cleanup_idx
  ON auth_login_throttle (updated_at);
