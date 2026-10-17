# SVG preparation guide for designers

Use an actual UTF-8 SVG, not a scanned image embedded inside an SVG wrapper.
Export paths and editable text; keep a valid `viewBox` and the SVG namespace.

Recommended structure:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800">
  <g id="roads"><path d="M0 200H1000V240H0Z" fill="#ddd"/></g>
  <g id="plot-12">
    <path d="M20 20H80V140H20Z" fill="#dcebdc" stroke="#333"/>
    <text x="45" y="85">12</text>
  </g>
  <rect data-plot-number="A-13" x="90" y="20" width="60" height="120"/>
</svg>
```

- One closed shape per plot inside a uniquely numbered group is most reliable.
  Use `data-plot-number` for identifiers that differ from a designer's internal ID.
- Do not put other independently numbered plots inside a numbered plot group.
- Separate roads, parks, boundary, compass, legends and titles into named layers.
  Those layers are ignored automatically; manual overrides are available in the Phase B review.
- Without identifiers, leave plot labels as text (not outlined letters) with x/y
  anchors inside the correct shape. Labels on shared edges or outside a plot are
  ambiguous; the detector deliberately reports unmatched labels.
- Close paths with `Z`; polyline endpoints must coincide. Rectangles and polygons
  work directly. Curves/arcs are approximated for geometry, not surveyed boundaries.
- Parent/local translate, scale, rotation, matrix and skew work. Flatten nested SVG
  viewports, symbols/`use`, clipping-dependent geometry and outlined-text plot numbers.
- Convert CSS styling to ordinary presentation attributes (`fill`, `stroke`, etc.).
  Scripts, animations, images, links, stylesheet rules, inline style and URL/escaped
  CSS attributes are removed for security. Do not rely on them to define plot geometry.
- Prefer numeric coordinates in user units/px, not percentages, physical units,
  text layout engines or CSS transforms. Text-only fallback uses the anchor point,
  not glyph width or browser text metrics.
- Calibrate scale and compare official area/dimensions in Phase B before publishing.
  SVG area alone is **not** square feet/marla/kanal and does not establish title,
  approved dimensions, facing or an official corner classification.
- Maximum upload is 10 MiB; simplify excessively sampled curves instead of raising
  limits. Do not upload buyer names, CNICs, bank details or other personal data in maps.

Try the three `samples/plots-*.svg` fixtures first; each contains eight synthetic
lots. They demonstrate explicit attributes/groups, text-only matching, and nested
transforms/curves/compound holes respectively. See `PLOT_MAP_PHASE_B.md` for current review/calibration/publish testing.
