/**
 * Godot scene/resource files (.tscn/.tres) surfaced to agents: `codegraph_node`
 * and the file-view render a structured scene summary (scene tree + script
 * attachments + signal wiring) instead of a raw inspector dump, and Godot
 * synthetic edges (scene-signal / engine-virtual) are labeled in trails so the
 * agent trusts the hop without Reading the .tscn to verify it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import CodeGraph from '../src/index';
import { ToolHandler } from '../src/mcp/tools';

const MENU_TSCN = [
  '[gd_scene load_steps=3 format=3]',
  '',
  '[ext_resource type="Script" path="res://menu.gd" id="1_menu"]',
  '[ext_resource type="Script" path="res://safe_area.gd" id="2_safe"]',
  '[ext_resource type="StyleBox" path="res://button_style.tres" id="3_style"]',
  '',
  '[sub_resource type="LabelSettings" id="LabelSettings_x"]',
  'font_size = 40',
  'outline_size = 6',
  '',
  '[node name="Menu" type="Control"]',
  'layout_mode = 3',
  'script = ExtResource("1_menu")',
  '',
  '[node name="SafeArea" type="Control" parent="."]',
  'script = ExtResource("2_safe")',
  '',
  '[node name="BtnSettings" type="BaseButton" parent="SafeArea"]',
  'unique_name_in_owner = true',
  'visible = true',
  'layout_mode = 0',
  '',
  '[connection signal="pressed" from="%BtnSettings" to="." method="_on_settings_pressed"]',
  '',
].join('\n');

const MENU_GD = [
  'extends Control',
  '',
  'func _ready() -> void:',
  '\tpass',
  '',
  'func _on_settings_pressed() -> void:',
  '\tget_tree().paused = true',
  '',
].join('\n');

const SAFE_AREA_GD = 'extends Control\n';

const THEME_TRES = [
  '[gd_resource type="StyleBoxFlat" format=3]',
  '',
  '[resource]',
  'bg_color = Color(0.1, 0.1, 0.1, 1)',
  'corner_radius_top_left = 8',
  '',
].join('\n');

describe('Godot scene/resource surfacing (codegraph_node)', () => {
  let dir: string;
  let cg: CodeGraph;
  let h: ToolHandler;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-gdscene-'));
    fs.writeFileSync(path.join(dir, 'menu.tscn'), MENU_TSCN);
    fs.writeFileSync(path.join(dir, 'menu.gd'), MENU_GD);
    fs.writeFileSync(path.join(dir, 'safe_area.gd'), SAFE_AREA_GD);
    fs.writeFileSync(path.join(dir, 'button_style.tres'), THEME_TRES);
    cg = CodeGraph.initSync(dir);
    await cg.indexAll();
    cg.resolveReferences();
    h = new ToolHandler(cg);
  });

  afterEach(() => {
    if (cg) cg.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const text = async (args: Record<string, unknown>): Promise<string> =>
    (await h.execute('codegraph_node', args)).content.map((c) => c.text).join('\n');

  it('file-view on a .tscn returns the scene summary, not the raw dump', async () => {
    const out = await text({ file: 'menu.tscn' });
    expect(out).toContain('**Scene tree:**');
    expect(out).toContain('Menu (Control)');
    expect(out).toContain('script=res://menu.gd');
    expect(out).toContain('SafeArea (Control)');
    expect(out).toContain('script=res://safe_area.gd');
    expect(out).toContain('BtnSettings (BaseButton) %BtnSettings');
    expect(out).toContain('**Signal connections (scene → handler):**');
    expect(out).toContain('`BtnSettings` [pressed] → `_on_settings_pressed`');
    // Inspector noise is NOT dumped — a raw Read would show layout_mode etc.
    expect(out).not.toContain('[gd_scene');
    expect(out).not.toContain('layout_mode = 3');
  });

  it('offset/limit on a scene file still returns raw windowed lines (Read parity)', async () => {
    const out = await text({ file: 'menu.tscn', offset: 1, limit: 4 });
    expect(out).toContain('1\t[gd_scene load_steps=3 format=3]');
    expect(out).not.toContain('**Scene tree:**');
  });

  it('symbol-mode on a scene node renders the summary and its own properties with includeCode', async () => {
    const out = await text({ symbol: 'BtnSettings', includeCode: true });
    expect(out).toContain('BtnSettings (BaseButton)');
    expect(out).toContain('**Properties of `BtnSettings` (BaseButton):**');
    expect(out).toContain('unique_name_in_owner = true');
  });

  it('trail labels the synthesized scene-signal hop (no .tscn Read needed to trust it)', async () => {
    const out = await text({ symbol: 'BtnSettings', includeCode: true });
    expect(out).toContain('`_on_settings_pressed`');
    expect(out).toContain('dynamic: scene signal `pressed` → handler');
  });

  it('trail labels godot-engine-virtual edges on a script callback', async () => {
    const out = await text({ symbol: '_ready' });
    expect(out).toContain('engine virtual `_ready`');
  });

  it('.tres files get a resource summary, not a raw dump', async () => {
    const out = await text({ file: 'button_style.tres' });
    expect(out).toContain('(godot resource)');
    expect(out).toContain('resource');
    expect(out).not.toContain('bg_color = Color');
    expect(out).not.toContain('corner_radius_top_left');
  });
});