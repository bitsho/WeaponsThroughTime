#!/usr/bin/env node
'use strict';
/* Validate every data file. Exit code 1 on problems — use in CI. */
process.env.WTT_NO_WATCH = '1';
const { Store } = require('../server/store');
const store = new Store();
const errors = store.validate();
const { aircraft, conflicts, lineage } = store.state;
console.log(`aircraft: ${aircraft.length}  conflicts: ${conflicts.length}  lineage links: ${lineage.length}`);
if (errors.length) { console.error(`\n✖ ${errors.length} problem(s):`); errors.forEach((e) => console.error('  - ' + e)); process.exit(1); }
console.log('✔ data is valid');
