/**
 * The hand-off to the editor's assistant.
 *
 * One pattern, used for everything UntangleIt asks an assistant to do. The
 * untangle brief goes through it, and so does a failure brief. Putting a
 * brief on the clipboard as well as into the chat is not belt and braces: a
 * person whose editor has no chat still gets the text, and a person whose
 * chat swallowed it can paste it somewhere else.
 *
 * Nothing here decides what to say. The brief arrives built, from Witness in
 * the failure case and from report/brief.ts in the untangle case, and this
 * only carries it.
 */
import * as vscode from 'vscode';

/** Puts a brief in front of the assistant, and says where it went. */
export async function handOff(brief: string): Promise<string> {
  await vscode.env.clipboard.writeText(brief);
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: brief });
    return 'The brief is in the editor chat and on your clipboard.';
  } catch {
    return 'The brief is on your clipboard. Paste it into the assistant you use.';
  }
}
