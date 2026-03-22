module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/community',
        'http://localhost:3000/topics',
      ],
      numberOfRuns: 1,
      settings: {
        chromeFlags: '--no-sandbox --disable-gpu',
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.85 }],
        'categories:accessibility': ['error', { minScore: 0.90 }],
        'categories:best-practices': ['error', { minScore: 0.90 }],
        'categories:seo': ['error', { minScore: 0.90 }],
      },
    },
  },
};
