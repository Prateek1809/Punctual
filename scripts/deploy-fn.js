const { spawnSync } = require('child_process');

// 1. Build Cloud Functions first
console.log('⚡ Building Cloud Functions...');
const buildResult = spawnSync('npm', ['--prefix', 'functions', 'run', 'build'], {
  stdio: 'inherit',
  shell: true
});

if (buildResult.status !== 0) {
  console.error('❌ Functions build failed. Aborting deployment.');
  process.exit(buildResult.status || 1);
}

// 2. Parse function target arguments
const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0) {
  console.error('❌ No functions specified.');
  console.error('\nUsage:');
  console.error('  npm run deploy:fn functions:<name>');
  console.error('  npm run deploy:fn functions:<name1>,functions:<name2>');
  console.error('  npm run deploy:fn <name1> <name2>\n');
  process.exit(1);
}

// Normalize arguments: support comma-separated or space-separated, with or without 'functions:' prefix
const targets = [];
for (const arg of rawArgs) {
  const parts = arg.split(',').map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const fnTarget = part.startsWith('functions:') ? part : `functions:${part}`;
    if (!targets.includes(fnTarget)) {
      targets.push(fnTarget);
    }
  }
}

const onlyArg = targets.join(',');
console.log(`🚀 Deploying function(s): ${onlyArg}\n`);

// 3. Execute Firebase deploy
const deployResult = spawnSync('firebase', ['deploy', '--only', onlyArg], {
  stdio: 'inherit',
  shell: true
});

process.exit(deployResult.status || 0);
