export type SetOp = {
  op: 'SET';
  coll: string;
  key: string;
  value: unknown;
  ts: number;
};

export type DelOp = {
  op: 'DEL';
  coll: string;
  key: string;
  ts: number;
};

export type IncrOp = {
  op: 'INCR';
  coll: string;
  key: string;
  field: string;
  delta: number;
  ts: number;
};

export type AppendOp = {
  op: 'APPEND';
  coll: string;
  value: unknown;
  ts: number;
};

export type StoreOp = SetOp | DelOp | IncrOp | AppendOp;

export function isStoreOp(value: unknown): value is StoreOp {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.op !== 'string' || typeof v.coll !== 'string' || typeof v.ts !== 'number') {
    return false;
  }
  switch (v.op) {
    case 'SET':
      return typeof v.key === 'string' && 'value' in v;
    case 'DEL':
      return typeof v.key === 'string';
    case 'INCR':
      return (
        typeof v.key === 'string' && typeof v.field === 'string' && typeof v.delta === 'number'
      );
    case 'APPEND':
      return 'value' in v;
    default:
      return false;
  }
}
