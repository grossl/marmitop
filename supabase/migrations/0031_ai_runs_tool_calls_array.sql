-- 0031_ai_runs_tool_calls_array.sql
--
-- runAiTurn wrote tool_calls with a bare ::jsonb cast, so postgres.js stored the JSON text as a
-- jsonb string scalar (ADR-039, FR-218). Turn those rows back into the array they hold.
-- Forward-only (NFR-062). Idempotent.

update public.ai_runs
set tool_calls = (tool_calls #>> '{}')::jsonb
where jsonb_typeof(tool_calls) = 'string';
