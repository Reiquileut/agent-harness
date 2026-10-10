# Overlay fixture

Used by `scripts/e2e/40-overlay.sh` and the Ubuntu bootstrap CI job. It has the
same shape as a real private overlay (`catalog.json` + `skills/`, `agents/`,
`presets/`) but only harmless test content. The `prd` skill deliberately
collides with the public catalog to prove the overlay entry wins.
