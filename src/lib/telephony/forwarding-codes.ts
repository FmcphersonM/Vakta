/**
 * Standard GSM (3GPP) call-forwarding codes. They work on Norwegian networks
 * (Telenor, Telia, Ice) and are dialled on the owner's own mobile phone.
 */
export function forwardingCodes(target: string, noAnswerSeconds = 20) {
  const n = target.replace(/\s/g, "");
  const secs = Math.min(30, Math.max(5, Math.round(noAnswerSeconds / 5) * 5));
  return {
    allConditional: `**004*${n}#`,
    noAnswer: `**61*${n}**${secs}#`,
    busy: `**67*${n}#`,
    unreachable: `**62*${n}#`,
    cancelAll: `##002#`,
  };
}
