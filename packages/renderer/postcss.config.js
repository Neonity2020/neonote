const path = require('path')

module.exports = {
  plugins: {
    // tailwind v3 的 postcss 插件默认相对 process.cwd 找配置，包被移动后 cwd 不再是
    // 包根，必须显式指向本包内的 tailwind.config.js
    tailwindcss: { config: path.join(__dirname, 'tailwind.config.js') },
    autoprefixer: {}
  }
}
