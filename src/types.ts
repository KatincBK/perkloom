export interface Position {
  x: number;
  y: number;
}

export type FieldType = 'text' | 'dropdown' | 'number' | 'boolean' | 'pool';

export interface DropdownOption {
  id: string;
  label: string;
}

export interface PoolEntry {
  itemId: string;
  count: number;
}

export interface PoolItem {
  id: string;
  name: string;
  color: string;
}

export interface PoolType {
  id: string;
  name: string;
  items: PoolItem[];
}

export interface FieldDefinition {
  id: string;
  name: string;
  type: FieldType;
  showOnMap: boolean;
  dropdownOptions: DropdownOption[];
  poolTypeId: string | null;
}

export interface DataType {
  id: string;
  name: string;
  color: string;
  fields: FieldDefinition[];
}

export interface MapLine {
  type: 'text' | 'pool-entry';
  text: string;
  color?: string;
}

export type NodeDisplayMode = 'expanded' | 'compact';

export interface SkillNode {
  id: string;
  title: string;
  position: Position;
  parentId: string | null;
  dataTypeId: string;
  fieldValues: Record<string, string | number | boolean | PoolEntry[]>;
  imageData?: string | null;
  displayMode: NodeDisplayMode;
  color?: string | null;
}

export type InteractionMode = 'static' | 'auto' | 'responsive' | 'engineer';
export type LayoutAlgorithm = 'tree' | 'radial' | 'horizontal' | 'force' | 'layered' | 'layered-td';

export type ProjectType = 'skilltree' | 'flowchart';

export function edgeId(fromId: string, toId: string): string {
  return `${fromId}->${toId}`;
}

export interface EdgeData {
  id: string;
  fromId: string;
  toId: string;
  name: string;
  description: string;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface NamedSnapshot {
  id: string;
  name: string;
  createdAt: number;
}
