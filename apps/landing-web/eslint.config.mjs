// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs';

export default withNuxt({
  rules: {
    // This is a landing page, not a component library — short, generic
    // names (Vehicle, Reveal, ...) read fine without a forced second word.
    'vue/multi-word-component-names': 'off',
  },
});
