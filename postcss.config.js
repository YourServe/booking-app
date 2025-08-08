// postcss.config.js
import tailwindPlugin from '@tailwindcss/postcss'
import autoprefixer    from 'autoprefixer'

export default {
  plugins: [
    tailwindPlugin(),    // ← invoke the PostCSS plugin
    autoprefixer(),
  ],
}
