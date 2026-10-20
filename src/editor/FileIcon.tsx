// EDIT-011 (T-316): the small icon beside a file name in the explorer, tab headers and pickers.
// One page outline with a mark inside that fits the file's kind (fileIcons.ts decides the kind).
import type { SVGProps } from "react";
import { fileKind, type FileKind } from "./fileIcons";

const PAGE = "M9 1.75H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.75L9 1.75Z M9 1.75v4h4";
const MARK: Record<FileKind, string> = {
  file: "",
  code: "M6.5 8.5 5 10l1.5 1.5m3-3L11 10l-1.5 1.5",
  markup: "M6.5 8.5 5 10l1.5 1.5m3-3L11 10l-1.5 1.5M8.4 8.2 7.6 11.8",
  data: "M6.5 8c-.8 0-1 .4-1 1v.5c0 .5-.3.8-.7 1 .4.2.7.5.7 1v.5c0 .6.2 1 1 1m3-4c.8 0 1 .4 1 1v.5c0 .5.3.8.7 1-.4.2-.7.5-.7 1v.5c0 .6-.2 1-1 1",
  table: "M5 8.5h6M5 10.5h6M5 12.5h6M8 8.5v4",
  doc: "M5.5 8.5h5M5.5 10.5h5M5.5 12.5h3",
  image: "M5 12.5l2-2.5 1.5 1.5L10 10l1.5 2.5M6 8.2h.01",
  archive: "M8 7v1m0 1.5v1m0 1.5v1.5",
  lock: "M6.5 10.5v-1a1.5 1.5 0 0 1 3 0v1M6 10.5h4v2.5H6Z",
  config: "M5.5 9h5M5.5 12h5M7.5 8v2M9 11v2",
  package: "M8 7.5l2.5 1.2v2.6L8 12.5l-2.5-1.2V8.7L8 7.5Zm0 0v5m-2.5-3.8L8 10l2.5-1.3",
  shell: "M5.5 8.5l2 1.5-2 1.5M8.5 12.5h2",
  notebook: "M5.5 8h5v4.5h-5ZM7 8v4.5",
  test: "M6 8.5v1.7l-1 2.3h4l-1-2.3V8.5M5.8 8.5h2.4",
  media: "M6.5 8.2v4l3.5-2-3.5-2Z",
};

type Props = Omit<SVGProps<SVGSVGElement>, "name"> & { name: string; size?: number };

export default function FileIcon({ name, size = 12, ...rest }: Props) {
  const kind = fileKind(name);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-kind={kind} {...rest}>
      <path d={PAGE} />
      {MARK[kind] && <path d={MARK[kind]} />}
    </svg>
  );
}
