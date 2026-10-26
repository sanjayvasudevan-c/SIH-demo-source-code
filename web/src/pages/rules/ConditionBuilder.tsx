// Row-based condition builder: "Field · operator · value", joined by All or Any, producing the JSON-logic subset
// the API accepts. Conditions it cannot show as rows open in the JSON editor (the API validates both).
import { useEffect, useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Input, SegmentedControl, Select, Textarea } from '../../components/ui';
import type { Expr } from './types';

export interface VarList {
  vars: Record<string, string>;
  prefixes: Record<string, string>;
}

type Op = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'true' | 'false';
interface Row {
  field: string;
  op: Op;
  value: string;
}

const OP_LABEL: Record<Op, string> = { '==': 'is', '!=': 'is not', '<': 'is less than', '<=': 'is at most', '>': 'is more than', '>=': 'is at least', in: 'is one of', true: 'is true', false: 'is false' };
const isVar = (v: unknown): v is { var: string } => typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { var?: unknown }).var === 'string';

function parseRow(e: unknown): Row | null {
  if (isVar(e)) return { field: e.var, op: 'true', value: '' };
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return null;
  const [op, args] = Object.entries(e)[0] ?? [];
  if (op === '!' && isVar(args)) return { field: args.var, op: 'false', value: '' };
  if (op === '!' && Array.isArray(args) && isVar(args[0])) return { field: args[0].var, op: 'false', value: '' };
  if (!Array.isArray(args) || args.length !== 2 || !isVar(args[0])) return null;
  const rhs = args[1];
  if (op === 'in' && Array.isArray(rhs)) return { field: args[0].var, op: 'in', value: rhs.map(String).join(', ') };
  if (['==', '!=', '<', '<=', '>', '>='].includes(op!)) {
    if (op === '==' && rhs === true) return { field: args[0].var, op: 'true', value: '' };
    if (op === '==' && rhs === false) return { field: args[0].var, op: 'false', value: '' };
    if (isVar(rhs)) return { field: args[0].var, op: op as Op, value: `@${rhs.var}` };
    return { field: args[0].var, op: op as Op, value: typeof rhs === 'string' ? rhs : JSON.stringify(rhs) };
  }
  return null;
}

/** null when the expression is not a simple All/Any of rows. */
export function parseRows(e: Expr): { join: 'and' | 'or'; rows: Row[]; always: boolean } | null {
  if (e === true) return { join: 'and', rows: [], always: true };
  const one = parseRow(e);
  if (one) return { join: 'and', rows: [one], always: false };
  if (typeof e === 'object' && e !== null && !Array.isArray(e)) {
    const [op, args] = Object.entries(e)[0] ?? [];
    if ((op === 'and' || op === 'or') && Array.isArray(args)) {
      const rows = args.map(parseRow);
      if (rows.every(Boolean)) return { join: op, rows: rows as Row[], always: false };
    }
  }
  return null;
}

function literal(value: string, type: string | undefined): unknown {
  const v = value.trim();
  if (v.startsWith('@')) return { var: v.slice(1) };
  if (type === 'number') return v === '' ? null : Number(v);
  if (type === 'boolean') return v === 'true';
  return v;
}

export function buildExpr(join: 'and' | 'or', rows: Row[], always: boolean, types: Record<string, string>): Expr {
  if (always || rows.length === 0) return true;
  const one = (r: Row): Expr => {
    const lhs = { var: r.field };
    if (r.op === 'true') return types[r.field] === 'boolean' ? { '==': [lhs, true] } : lhs;
    if (r.op === 'false') return types[r.field] === 'boolean' ? { '==': [lhs, false] } : { '!': lhs };
    if (r.op === 'in') return { in: [lhs, r.value.split(',').map((x) => literal(x, types[r.field])).filter((x) => x !== '' && x !== null)] };
    return { [r.op]: [lhs, literal(r.value, types[r.field])] };
  };
  return rows.length === 1 ? one(rows[0]!) : { [join]: rows.map(one) };
}

export function describeExpr(e: Expr): string {
  const p = parseRows(e);
  if (!p) return 'Custom condition (see JSON)';
  if (p.always) return 'Always';
  return p.rows.map((r) => `${r.field} ${OP_LABEL[r.op]}${r.op === 'true' || r.op === 'false' ? '' : ` ${r.value}`}`).join(p.join === 'and' ? ' and ' : ' or ');
}

export function ConditionBuilder({ label, value, onChange, vars, normKeys, disabled }: { label: string; value: Expr; onChange: (e: Expr) => void; vars: VarList | undefined; normKeys: string[]; disabled?: boolean }) {
  const parsed = useMemo(() => parseRows(value), [value]);
  const [mode, setMode] = useState<'rows' | 'json'>(parsed ? 'rows' : 'json');
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const base = useId();
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  const types: Record<string, string> = { ...(vars?.vars ?? {}), ...Object.fromEntries(normKeys.map((k) => [`norms.${k}`, 'number'])) };
  const fields = Object.keys(types).sort();
  const state = parsed ?? { join: 'and' as const, rows: [], always: false };
  const set = (join: 'and' | 'or', rows: Row[], always: boolean) => onChange(buildExpr(join, rows, always, types));

  return (
    <fieldset className="flex flex-col gap-2 rounded border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl label={`${label}: editor`} value={mode} options={[{ value: 'rows', label: 'Rows' }, { value: 'json', label: 'JSON' }]} onChange={(m) => (m === 'rows' && !parsed ? setJsonError('This condition cannot be shown as rows; edit it as JSON.') : setMode(m))} />
        {mode === 'rows' ? (
          <SegmentedControl label={`${label}: join`} value={state.always ? 'always' : state.join} options={[{ value: 'always', label: 'Always' }, { value: 'and', label: 'All of' }, { value: 'or', label: 'Any of' }]} onChange={(j) => (j === 'always' ? set('and', [], true) : set(j, state.rows.length ? state.rows : [{ field: fields[0] ?? '', op: '==', value: '' }], false))} />
        ) : null}
      </div>
      {mode === 'rows' && !state.always ? (
        <div className="flex flex-col gap-2">
          {state.rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select aria-label={`Row ${i + 1} field`} value={r.field} onChange={(e) => set(state.join, state.rows.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)), false)} className="w-64">
                {fields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
              <Select aria-label={`Row ${i + 1} operator`} value={r.op} onChange={(e) => set(state.join, state.rows.map((x, j) => (j === i ? { ...x, op: e.target.value as Op } : x)), false)} className="w-40">
                {(Object.keys(OP_LABEL) as Op[]).map((o) => (
                  <option key={o} value={o}>
                    {OP_LABEL[o]}
                  </option>
                ))}
              </Select>
              {r.op !== 'true' && r.op !== 'false' ? (
                <Input
                  aria-label={`Row ${i + 1} value`}
                  list={`${base}-norms`}
                  value={r.value}
                  placeholder={r.op === 'in' ? 'BBA, BCA, BMS' : types[r.field] === 'number' ? '50 or @norms.key' : 'value'}
                  onChange={(e) => set(state.join, state.rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)), false)}
                  className="w-48"
                />
              ) : null}
              <IconButton label={`Remove row ${i + 1}`} icon={<Trash2 size={16} aria-hidden />} onClick={() => set(state.join, state.rows.filter((_, j) => j !== i), false)} />
            </div>
          ))}
          <datalist id={`${base}-norms`}>
            {normKeys.map((k) => (
              <option key={k} value={`@norms.${k}`} />
            ))}
          </datalist>
          <div>
            <Button size="sm" variant="tertiary" icon={<Plus size={16} aria-hidden />} onClick={() => set(state.join, [...state.rows, { field: fields[0] ?? '', op: '==', value: '' }], false)}>
              Add a row
            </Button>
          </div>
        </div>
      ) : null}
      {mode === 'json' ? (
        <Textarea
          aria-label={`${label} as JSON`}
          className="font-mono text-sm"
          rows={4}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            try {
              onChange(JSON.parse(e.target.value));
              setJsonError(null);
            } catch {
              setJsonError('Not valid JSON yet.');
            }
          }}
        />
      ) : null}
      {jsonError ? <p className="text-sm text-warning">{jsonError}</p> : null}
    </fieldset>
  );
}
