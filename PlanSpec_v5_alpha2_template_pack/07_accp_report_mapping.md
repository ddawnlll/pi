# ACCP Report Mapping for PlanSpec v5 alpha2

ACCP remains the evidence and communication protocol. It is not an execution contract.

PlanSpec defines what should happen. PlanLock freezes what may execute. ExecutionKernel controls state. ACCP reports prove what happened.

## Mapping

| PlanSpec Event | ACCP Report | Required? |
|---|---|---:|
| Repo inspection | RIR | Yes |
| Plan review | PIR | Yes |
| Workspace mutation | IPR | Yes |
| Workspace validation | TVR | Yes |
| Handoff/blocker | HIR | Conditional |
| Regression | RAR | Conditional |
| Final promotion | PRR | Yes |
| Report correction | CAR | Conditional |

## alpha2 rule

Command evidence must include whether the command was exact-allowed, command-class allowed, or runtime-granted. Discovery commands cannot satisfy final validation.
