const path = require('path')

module.exports = {
  plugins: {
    // The Tailwind v3 PostCSS plugin resolves its config relative to
    // process.cwd. Once the package is moved out of the repo root the cwd is
    // no longer the package root, so the config path is pinned explicitly.
    tailwindcss: { config: path.join(__dirname, 'tailwind.config.js') },
    autoprefixer: {}
  }
}
