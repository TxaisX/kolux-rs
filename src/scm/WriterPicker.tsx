// GIT-018 (T-228-d): who writes commit messages: an installed agent with its model (listed from the
// installed CLI) and thinking effort, a custom command, or nobody.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WRITER_COMMAND_KEY, WRITER_EFFORT_KEY, WRITER_KEY, writerName, writerOf } from "./generate";
import { agentChoices, agentPatch, effortsFor, modelMode, modelPatch, pickerHint, type WriterOptions } from "./writerPick";

type Props = { settings: Record<string, unknown>; save: (patch: Record<string, unknown>) => unknown };

export default function WriterPicker({ settings, save }: Props) {
  const writer = writerOf(settings);
  const stored = settings[WRITER_KEY];
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  const [options, setOptions] = useState<WriterOptions | null>(null);
  useEffect(() => {
    invoke<{ id: string; installed: boolean }[]>("agent_list").then(
      (l) => setInstalled(new Set(l.filter((a) => a.installed).map((a) => a.id))),
      () => setInstalled(null),
    );
  }, []);
  const agent = writer.mode === "agent" ? writer.agent : null;
  useEffect(() => {
    setOptions(null);
    if (agent === null) return;
    let live = true;
    invoke<WriterOptions>("scm_writer_options", { agent }).then(
      (o) => live && setOptions(o),
      (e) => live && setOptions({ agent, name: writerName(agent), installed: false, models: [], efforts: [], hint: String(e) }),
    );
    return () => {
      live = false;
    };
  }, [agent]);
  const efforts = effortsFor(options, writer.model);
  const mode = modelMode(options);
  return (
    <>
      <div className="look-select">
        <span>Written by</span>
        <select aria-label="commit message writer" className="field" value={stored === "custom" || stored === "off" ? String(stored) : (agent ?? "claude")} onChange={(e) => void save(e.target.value === "custom" || e.target.value === "off" ? { [WRITER_KEY]: e.target.value } : agentPatch(e.target.value))}>
          {agentChoices(installed, agent ?? "claude").map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.installed ? "" : " (not installed)"}
            </option>
          ))}
          <option value="custom">Custom command</option>
          <option value="off">Off: no generate button</option>
        </select>
      </div>
      {agent !== null && (
        <>
          <div className="look-select">
            <span>Model</span>
            {mode === "list" ? (
              <select aria-label="commit message model" className="field" value={writer.model ?? ""} onChange={(e) => void save(modelPatch(options, e.target.value, writer.effort))}>
                <option value="">Default{agent === "claude" ? " (Sonnet)" : ""}</option>
                {writer.model !== null && !options?.models.some((m) => m.id === writer.model) && <option value={writer.model}>{writer.model}</option>}
                {options?.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                key={writer.model ?? ""}
                aria-label="commit message model"
                className="field"
                placeholder="Default"
                defaultValue={writer.model ?? ""}
                onBlur={(e) => e.target.value.trim() !== (writer.model ?? "") && void save(modelPatch(options, e.target.value, writer.effort))}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            )}
          </div>
          {efforts.length > 0 && (
            <div className="look-select">
              <span>Thinking effort</span>
              <select aria-label="commit message effort" className="field" value={writer.effort ?? ""} onChange={(e) => void save({ [WRITER_EFFORT_KEY]: e.target.value })}>
                <option value="">Default</option>
                {writer.effort !== null && !efforts.includes(writer.effort) && <option value={writer.effort}>{writer.effort}</option>}
                {efforts.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          )}
          {pickerHint(options) && (
            <p className="conn-detail" data-writer-hint>
              {pickerHint(options)}
            </p>
          )}
        </>
      )}
      {stored === "custom" && (
        <>
          <input
            key={String(settings[WRITER_COMMAND_KEY] ?? "")}
            aria-label="custom commit message command"
            className="field"
            placeholder="e.g. my-writer --text {prompt}"
            defaultValue={String(settings[WRITER_COMMAND_KEY] ?? "")}
            onBlur={(e) => e.target.value !== String(settings[WRITER_COMMAND_KEY] ?? "") && void save({ [WRITER_COMMAND_KEY]: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <p className="conn-detail">The prompt goes wherever <code>{"{prompt}"}</code> appears in the command, or on its standard input when it does not. Put quotes around a word with spaces in it; backslashes are kept as typed.</p>
        </>
      )}
    </>
  );
}
