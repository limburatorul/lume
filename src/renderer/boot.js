/* Runs before the stylesheet. The material, and whether the shadow gutter is
   in use, has to be known on the first paint: applying it later flashes a
   square, borderless frame and then snaps to the real one. */
var q = new URLSearchParams(location.search)
var root = document.documentElement
var material = q.get('material')
var backdrop = q.get('backdrop')
var shadow = q.get('shadow')
var animate = q.get('animate')
if (material) root.dataset.material = material
if (backdrop) root.dataset.backdrop = backdrop
if (shadow) root.dataset.shadow = shadow
if (animate) root.dataset.animate = animate
