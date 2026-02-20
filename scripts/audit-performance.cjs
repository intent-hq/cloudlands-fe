#!/usr/bin/env node

/**
 * Performance Audit Script
 * Comprehensive audit of performance optimizations
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

// Files to audit
const filesToAudit = [
  'src/features/agent/services/performance-optimizer.ts',
  'src/features/agent/services/performance-worker.js',
  'src/features/agent/services/performance-dashboard.ts',
  'src/features/agent/agent.service.ts',
  'src/features/agent/services/stream-manager.ts',
  'src/lib/components/PerformanceDashboard.svelte',
];

// Performance features to check
const performanceFeatures = {
  'Memoization Cache': {
    files: ['performance-optimizer.ts'],
    patterns: ['memoCache', 'getMemoized', 'memoize'],
  },
  'Request Coalescing': {
    files: ['performance-optimizer.ts'],
    patterns: ['pendingRequests', 'coalesce', 'requestQueue'],
  },
  'Worker Pool': {
    files: ['performance-optimizer.ts', 'performance-worker.js'],
    patterns: ['workerPool', 'Worker', 'postMessage'],
  },
  'Performance Tracking': {
    files: ['agent.service.ts', 'stream-manager.ts'],
    patterns: ['performanceOptimizer.track', 'track<T>'],
  },
  'Metrics Collection': {
    files: ['performance-optimizer.ts', 'performance-dashboard.ts'],
    patterns: ['metrics', 'getStats', 'recordMetric'],
  },
  'Cache Management': {
    files: ['performance-optimizer.ts'],
    patterns: ['cleanupCache', 'LRU', 'MAX_CACHE_SIZE'],
  },
  'Real-time Monitoring': {
    files: ['performance-dashboard.ts', 'PerformanceDashboard.svelte'],
    patterns: ['updateMetrics', 'performanceStatus', 'alerts'],
  },
  'Response Time Targets': {
    files: ['performance-optimizer.ts'],
    patterns: ['TARGET_RESPONSE_TIME', '100', 'p95', 'p99'],
  },
};

// Audit function
function auditPerformance() {
  console.log('🔍 Performance Optimization Audit\n');
  console.log('='.repeat(60));
  console.log('\n');

  let totalScore = 0;
  let maxScore = 0;
  const results = [];

  // Check file existence
  console.log('📁 Checking Files:\n');
  let allFilesExist = true;

  filesToAudit.forEach((file) => {
    const filePath = path.join(rootDir, file);
    const exists = fs.existsSync(filePath);
    console.log(`  ${exists ? '✅' : '❌'} ${file}`);
    if (!exists) allFilesExist = false;
  });

  console.log('\n');

  // Check performance features
  console.log('🚀 Performance Features:\n');

  Object.entries(performanceFeatures).forEach(([feature, config]) => {
    let featureFound = false;
    let matchCount = 0;

    config.files.forEach((fileName) => {
      const file = filesToAudit.find((f) => f.includes(fileName));
      if (file) {
        const filePath = path.join(rootDir, file);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');

          config.patterns.forEach((pattern) => {
            if (content.includes(pattern)) {
              matchCount++;
            }
          });
        }
      }
    });

    featureFound = matchCount > 0;
    const score = featureFound ? (matchCount / config.patterns.length) * 10 : 0;
    totalScore += score;
    maxScore += 10;

    console.log(`  ${featureFound ? '✅' : '❌'} ${feature}`);
    console.log(
      `     Score: ${score.toFixed(1)}/10 (${matchCount}/${config.patterns.length} patterns found)`
    );
    console.log('');

    results.push({
      feature,
      implemented: featureFound,
      score,
      matchCount,
      totalPatterns: config.patterns.length,
    });
  });

  // Calculate overall score
  const percentage = (totalScore / maxScore) * 100;

  console.log('='.repeat(60));
  console.log('\n📊 Audit Summary:\n');
  console.log(`  Overall Score: ${totalScore.toFixed(1)}/${maxScore} (${percentage.toFixed(1)}%)`);
  console.log(`  Files Checked: ${filesToAudit.length}`);
  console.log(
    `  Features Implemented: ${results.filter((r) => r.implemented).length}/${results.length}`
  );

  // Performance grade
  let grade;
  if (percentage >= 90) grade = 'A+ 🏆';
  else if (percentage >= 80) grade = 'A 🎯';
  else if (percentage >= 70) grade = 'B ✅';
  else if (percentage >= 60) grade = 'C ⚠️';
  else grade = 'D ❌';

  console.log(`  Grade: ${grade}`);
  console.log('');

  // Recommendations
  const missingFeatures = results.filter((r) => !r.implemented);
  if (missingFeatures.length > 0) {
    console.log('⚠️  Missing Features:\n');
    missingFeatures.forEach((f) => {
      console.log(`  - ${f.feature}`);
    });
    console.log('');
  }

  // Success message
  if (percentage >= 80) {
    console.log('🎉 Performance optimizations are well implemented!');
  } else {
    console.log('💡 Consider implementing missing features for better performance.');
  }

  console.log('\n' + '='.repeat(60));

  return percentage >= 80;
}

// Run audit
if (require.main === module) {
  const success = auditPerformance();
  process.exit(success ? 0 : 1);
}
