BEGIN;

CREATE TABLE financial_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('debt', 'subscription', 'project', 'custom')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  target_amount_xof bigint CHECK (target_amount_xof IS NULL OR target_amount_xof > 0),
  remaining_amount_xof bigint CHECK (remaining_amount_xof IS NULL OR remaining_amount_xof >= 0),
  planned_amount_xof bigint NOT NULL CHECK (planned_amount_xof >= 0),
  due_on date,
  cadence text CHECK (cadence IS NULL OR cadence IN ('once', 'weekly', 'monthly', 'yearly')),
  priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  deferral_impact text NOT NULL DEFAULT '' CHECK (length(deferral_impact) <= 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  CHECK (target_amount_xof IS NULL OR remaining_amount_xof IS NULL OR remaining_amount_xof <= target_amount_xof)
);

CREATE INDEX financial_item_owner_kind_status_idx
  ON financial_item (owner_id, kind, status);
CREATE INDEX financial_item_owner_due_idx
  ON financial_item (owner_id, status, due_on);

ALTER TABLE financial_transaction
  ADD COLUMN financial_item_id uuid;

ALTER TABLE financial_transaction
  ADD CONSTRAINT financial_transaction_item_owner_fk
  FOREIGN KEY (financial_item_id, owner_id)
  REFERENCES financial_item (id, owner_id) ON DELETE RESTRICT;

CREATE INDEX financial_transaction_item_idx
  ON financial_transaction (owner_id, financial_item_id)
  WHERE financial_item_id IS NOT NULL;

CREATE TABLE unexpected_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  amount_xof bigint NOT NULL CHECK (amount_xof > 0),
  occurred_on date NOT NULL,
  due_on date,
  urgency smallint NOT NULL DEFAULT 3 CHECK (urgency BETWEEN 1 AND 5),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planned', 'resolved')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);

CREATE INDEX unexpected_event_owner_status_due_idx
  ON unexpected_event (owner_id, status, due_on);

CREATE TABLE scenario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  budget_month date NOT NULL,
  event_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied')),
  data_version text NOT NULL,
  result jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE (id, owner_id),
  FOREIGN KEY (event_id, owner_id) REFERENCES unexpected_event (id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX scenario_owner_month_idx ON scenario (owner_id, budget_month DESC);

CREATE TABLE scenario_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  scenario_id uuid NOT NULL,
  financial_item_id uuid,
  action text NOT NULL CHECK (action IN ('reduce', 'defer', 'pause', 'allocate')),
  amount_delta_xof bigint NOT NULL DEFAULT 0,
  consequence text NOT NULL CHECK (length(consequence) <= 500),
  FOREIGN KEY (scenario_id, owner_id) REFERENCES scenario (id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (financial_item_id, owner_id) REFERENCES financial_item (id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX scenario_action_scenario_idx ON scenario_action (owner_id, scenario_id);

CREATE TABLE idempotency_record (
  owner_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  operation text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, operation, idempotency_key)
);

CREATE TABLE recommendation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  scenario_id uuid,
  input_snapshot jsonb NOT NULL,
  result jsonb NOT NULL,
  provider text NOT NULL CHECK (provider IN ('rules', 'groq')),
  model text,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  prompt_version smallint NOT NULL DEFAULT 1 CHECK (prompt_version = 1),
  candidate_hash text NOT NULL CHECK (length(candidate_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (scenario_id, owner_id) REFERENCES scenario (id, owner_id) ON DELETE SET NULL (scenario_id)
);

CREATE INDEX recommendation_owner_created_idx ON recommendation (owner_id, created_at DESC);

CREATE TABLE groq_request_throttle (
  owner_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0)
);

COMMIT;
