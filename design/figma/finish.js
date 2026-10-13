return (async () => {
  // FigCli Plugin API script: modifies existing layers only; never creates visual nodes.
  const work = await figma.getNodeByIdAsync('2:155');
  const form = await figma.getNodeByIdAsync('2:2');
  const map = await figma.getNodeByIdAsync('2:295');
  const lake = await figma.getNodeByIdAsync('2:650');
  const variables = await figma.variables.getLocalVariablesAsync('COLOR');
  const lakeVariable = variables.find(v => v.name === 'lake');
  if (!work || !form || !map || !lake || !lakeVariable) throw new Error('Expected design nodes missing.');
  // The renderer does not apply shape rotation and fails on slash-containing Ellipse names.
  // Reuse the already-created empty layer as an editable rounded lake shape.
  lake.name = 'Lake - schematic';
  lake.resize(360, 410);
  lake.cornerRadius = 180;
  lake.fills = [figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 0.8, g: 0.9, b: 0.9 } }, 'color', lakeVariable)];
  map.insertChild(0, lake);
  lake.x = 30;
  lake.y = 64;
  const rotations = { 'Park / schematic': -12, 'Road 0 / schematic': -28,
    'Road 1 / schematic': -30, 'Road 2 / schematic': 12,
    'Route segment 0 / schematic': -40, 'Route segment 1 / schematic': -34 };
  for (const n of map.children) {
    if (rotations[n.name] !== undefined) {
      const x = n.x, y = n.y;
      n.rotation = rotations[n.name];
      n.x = x; n.y = y;
    }
    if (n.type === 'TEXT' && n.characters === '西湖') { n.x = 126; n.y = 258; }
    if (n.name === 'Map disclaimer') {
      n.resize(300, 36);
      n.primaryAxisSizingMode = 'FIXED';
      n.counterAxisSizingMode = 'FIXED';
    }
  }
  for (const n of form.findAll(n => n.type === 'TEXT' && ['目的地', '同行人数', '每餐人均'].includes(n.characters))) {
    n.parent.parent.counterAxisAlignItems = 'MIN';
  }
  const columns = work.findOne(n => n.name === 'Workbench columns');
  columns.children[2].itemSpacing = 14;
  // Prototype reaction writes failed verification in this session.
  // Deliver editable static screens; do not claim the buttons perform real actions.
  figma.viewport.scrollAndZoomIntoView([work]);
  return { map: map.id, lake: lake.id, adjustedForm: form.id, adjustedWorkbench: work.id,
    lakeSize: { w: lake.width, h: lake.height }, prototype: 'static_design_only' };
})()
