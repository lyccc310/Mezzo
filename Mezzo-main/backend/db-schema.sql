-- Mezzo Database Schema
-- Run once against a fresh PostgreSQL database to create all tables.

-- Users cache (synced from Cognito on first login)
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    cognito_sub     VARCHAR(128) UNIQUE NOT NULL,
    username        VARCHAR(128) UNIQUE NOT NULL,
    display_name    VARCHAR(256),
    unit            VARCHAR(128),
    role            VARCHAR(32) DEFAULT 'officer',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    last_login      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_cognito_sub ON users(cognito_sub);

-- Devices (last known state, replaces connectedDevices Map)
CREATE TABLE IF NOT EXISTS devices (
    id                    SERIAL PRIMARY KEY,
    device_id             VARCHAR(128) UNIQUE NOT NULL,
    device_type           VARCHAR(32) DEFAULT 'unknown',
    lat                   DOUBLE PRECISION,
    lng                   DOUBLE PRECISION,
    alt                   DOUBLE PRECISION DEFAULT 0,
    callsign              VARCHAR(128),
    device_group          VARCHAR(64) DEFAULT 'PTT',
    role                  VARCHAR(32),
    status                VARCHAR(32) DEFAULT 'active',
    source                VARCHAR(32),
    stream_url            TEXT,
    is_bwc                BOOLEAN DEFAULT FALSE,
    stream_channel_index  INTEGER DEFAULT 0,
    recording             BOOLEAN DEFAULT FALSE,
    last_update           TIMESTAMPTZ DEFAULT NOW(),
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_group ON devices(device_group);

-- Device position history (HIGH-VOLUME, written in batches)
CREATE TABLE IF NOT EXISTS device_positions (
    id              BIGSERIAL PRIMARY KEY,
    device_id       VARCHAR(128) NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lng             DOUBLE PRECISION NOT NULL,
    alt             DOUBLE PRECISION DEFAULT 0,
    channel         VARCHAR(64),
    recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_device_time ON device_positions(device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_recorded_at ON device_positions(recorded_at DESC);

-- Messages (replaces in-memory messages array)
CREATE TABLE IF NOT EXISTS messages (
    id              SERIAL PRIMARY KEY,
    message_id      VARCHAR(64) UNIQUE NOT NULL,
    from_user       VARCHAR(128) NOT NULL,
    to_target       VARCHAR(128) NOT NULL,
    text            TEXT NOT NULL,
    priority        SMALLINT DEFAULT 3,
    source          VARCHAR(32),
    channel         VARCHAR(64),
    audio_data      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_user);

-- SOS Alerts (replaces pttState.sosAlerts Map)
CREATE TABLE IF NOT EXISTS sos_alerts (
    id              SERIAL PRIMARY KEY,
    alert_id        VARCHAR(128) UNIQUE NOT NULL,
    device_id       VARCHAR(128) NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lng             DOUBLE PRECISION NOT NULL,
    alt             DOUBLE PRECISION DEFAULT 0,
    callsign        VARCHAR(128),
    channel         VARCHAR(64),
    priority        SMALLINT DEFAULT 1,
    status          VARCHAR(32) DEFAULT 'active',
    resolved_by     VARCHAR(128),
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_alerts(status);
CREATE INDEX IF NOT EXISTS idx_sos_created_at ON sos_alerts(created_at DESC);

-- Call records (private calls)
CREATE TABLE IF NOT EXISTS call_records (
    id                  SERIAL PRIMARY KEY,
    private_topic_id    VARCHAR(128) NOT NULL,
    channel             VARCHAR(64),
    from_device         VARCHAR(128) NOT NULL,
    to_device           VARCHAR(128) NOT NULL,
    started_at          TIMESTAMPTZ NOT NULL,
    ended_at            TIMESTAMPTZ,
    duration_seconds    INTEGER,
    status              VARCHAR(32) DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_calls_status ON call_records(status);
CREATE INDEX IF NOT EXISTS idx_calls_started ON call_records(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_from ON call_records(from_device);
