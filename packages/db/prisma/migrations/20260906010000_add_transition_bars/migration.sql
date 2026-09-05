-- Planned mix length for a transition, in bars — plan §10.2's recipe.
--
-- Nullable rather than defaulted: §10.1 quick-creates a transition with a
-- default technique and leaves the rest to be refined in the inspector, so
-- "not decided yet" is a state the model has to be able to hold. A default of
-- 0 or 32 would put a claim in every existing row that nobody made.
ALTER TABLE "transitions" ADD COLUMN "bars" INTEGER;
