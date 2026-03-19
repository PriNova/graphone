export interface ParsedSkillBlock {
  name: string;
  location: string;
  content: string;
  userMessage?: string;
}

export interface ParsedSkillCommand {
  skillName: string;
  args: string;
}

export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = text.match(
    /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/,
  );

  if (!match) {
    return null;
  }

  return {
    name: match[1],
    location: match[2],
    content: match[3],
    userMessage: match[4]?.trim() || undefined,
  };
}

export function parseSkillCommand(text: string): ParsedSkillCommand | null {
  if (!text.startsWith("/skill:")) {
    return null;
  }

  const spaceIndex = text.indexOf(" ");
  const skillName =
    spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
  const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

  if (skillName.length === 0) {
    return null;
  }

  return { skillName, args };
}

export function normalizeSkillUserMessage(text: string | undefined): string {
  if (!text) {
    return "";
  }

  return text.replace(/^User:\s*/i, "").trim();
}

export function getSkillAwareDisplayText(
  text: string | null | undefined,
): string {
  const trimmed = text?.trim() ?? "";

  if (trimmed.length === 0) {
    return "";
  }

  const skillBlock = parseSkillBlock(trimmed);
  if (skillBlock) {
    const userMessage = normalizeSkillUserMessage(skillBlock.userMessage);
    return userMessage.length > 0 ? userMessage : `Skill: ${skillBlock.name}`;
  }

  const skillCommand = parseSkillCommand(trimmed);
  if (skillCommand) {
    return skillCommand.args.length > 0
      ? skillCommand.args
      : `Skill: ${skillCommand.skillName}`;
  }

  return trimmed;
}
