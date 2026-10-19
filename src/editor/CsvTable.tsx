// EDIT-023 (T-316): the grid an editor tab shows for a CSV or TSV file. It follows the tab's open
// text live, shows the first rows only (SHOWN_ROWS) so a huge file never locks the view, and the
// first row is the header. Cells are text, never HTML.
import { useEffect, useMemo, useState } from "react";
import { subscribe, textOf } from "./buffers";
import { parseTable, SHOWN_ROWS } from "./csv";

type Props = { path: string; loaded: number; hidden?: boolean };

export default function CsvTable({ path, loaded, hidden = false }: Props) {
  const [text, setText] = useState(() => textOf(path) ?? "");
  useEffect(() => {
    const read = () => setText(textOf(path) ?? "");
    read();
    return subscribe(path, read);
  }, [path, loaded]);
  const table = useMemo(() => (hidden ? null : parseTable(text, path)), [text, path, hidden]);
  if (!table) return null;
  const [head = [], ...body] = table.rows;
  const rows = body.slice(0, SHOWN_ROWS);
  const width = table.rows.reduce((w, r) => Math.max(w, r.length), 0);
  const cells = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  const sepName = table.sep === "\t" ? "tab" : table.sep === ";" ? "semicolon" : table.sep === "|" ? "pipe" : "comma";
  return (
    <div className="pane-body csv-table" role="region" aria-label={`${path.split(/[\\/]/).pop()}, table view`}>
      {table.rows.length === 0 ? (
        <p className="csv-note">This file is empty.</p>
      ) : (
        <>
          <p className="csv-note">
            {body.length === 1 ? "1 row" : `${body.length} rows`}, {width === 1 ? "1 column" : `${width} columns`}, separated by {sepName}
            {body.length > rows.length && ` (showing the first ${rows.length}; the source view has them all)`}
          </p>
          <div className="csv-scroll">
            <table>
              <thead>
                <tr>
                  <th className="csv-n" scope="col" aria-label="Row" />
                  {cells(head).map((c, i) => (
                    <th key={i} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, n) => (
                  <tr key={n}>
                    <th className="csv-n" scope="row">
                      {n + 1}
                    </th>
                    {cells(r).map((c, i) => (
                      <td key={i}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
