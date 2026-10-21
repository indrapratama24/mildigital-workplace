-- A request can now have several peer delegates (one row per delegate).
DROP INDEX "DelegationAssignment_requestId_key";
CREATE UNIQUE INDEX "DelegationAssignment_requestId_delegateId_key" ON "DelegationAssignment"("requestId", "delegateId");
CREATE INDEX "DelegationAssignment_requestId_idx" ON "DelegationAssignment"("requestId");
