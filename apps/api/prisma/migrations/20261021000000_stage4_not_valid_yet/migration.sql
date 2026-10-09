-- Stage 4 decision: a reservation whose campaign has not started yet is its own staff result (amber, recoverable).
ALTER TYPE "RedemptionResult" ADD VALUE IF NOT EXISTS 'NOT_VALID_YET';
