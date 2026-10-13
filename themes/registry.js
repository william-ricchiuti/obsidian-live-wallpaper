// themes/registry.js — loaded first as a plain <script>; creates the THEMES
// object that every theme file registers on.
//
// Two kinds of theme:
//   kind 'scene' — draw(ctx, S, t) paints the whole frame from a scene object
//                  (see _scenekit.js). All new themes use this.
//   kind 'hooks' — replaces individual stages of the default pipeline:
//                  drawBackground, drawEdges, drawParticles, drawNodes,
//                  drawLabels. Missing hooks fall back to the default stage.
// The theme id is the file name, which parser.js uses as the allowed values
// of the `theme` config key.
window.THEMES = window.THEMES || {};
THEMES.default = { kind: 'default', name: 'Default', dark: true };
