// EDIT-029 (T-235-b): an SVG file is a picture and text at once. This is its picture side, drawn from the tab's open
// text (so unsaved edits show at once) through an <img>, which never runs the file's scripts; the Source view is the
// ordinary text editor, so the file's source can be read, edited and diffed like any other text.
import { useEffect, useMemo, useState } from "react";
import ImageCanvas from "./ImageCanvas";
import { baseName, subscribe, textOf } from "./buffers";

type Props = { path: string; loaded: number; hidden?: boolean };

export default function SvgView({ path, loaded, hidden = false }: Props) {
  const [text, setText] = useState(() => textOf(path) ?? "");
  useEffect(() => {
    const read = () => setText(textOf(path) ?? "");
    read();
    return subscribe(path, read);
  }, [path, loaded]);
  const src = useMemo(() => (hidden || !text ? null : URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }))), [text, hidden]);
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);
  return <ImageCanvas src={src} error={!hidden && !text ? "empty" : null} name={baseName(path)} bytes={new Blob([text]).size} hidden={hidden} />;
}
