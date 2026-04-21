import type { JsonObject } from "./types";

export interface SlotGroupContext {
  listingIds?: Array<number | string> | undefined;
  skillId?: number | string | undefined;
  skillName?: string | undefined;
}

export interface SlotRow {
  endTime?: string | undefined;
  group?: SlotGroupContext | undefined;
  isExperiencingSurge: boolean;
  isFull: boolean;
  slotsLeft?: number | undefined;
  startTime: string;
  surgePrice?: number | undefined;
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return;
  }
  const text = String(value).trim();
  return text || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSlot(
  item: JsonObject,
  group?: SlotGroupContext
): SlotRow | undefined {
  const startTime = stringValue(item.startTime ?? item.start);
  if (!startTime) {
    return;
  }
  const existingGroup = asObject(item.group);
  return {
    endTime: stringValue(item.endTime ?? item.end),
    group: group ?? (existingGroup ? groupContext(existingGroup) : undefined),
    isExperiencingSurge: item.isExperiencingSurge === true,
    isFull: item.isFull === true,
    slotsLeft: numberValue(item.slotsLeft ?? item.available),
    startTime,
    surgePrice: numberValue(item.surgePrice),
  };
}

function slotsFromArray(value: unknown, group?: SlotGroupContext): SlotRow[] {
  return asArray(value).flatMap((item) => {
    const slot = asObject(item);
    const normalized = slot ? normalizeSlot(slot, group) : undefined;
    return normalized ? [normalized] : [];
  });
}

function groupContext(group: JsonObject): SlotGroupContext {
  const listingIds = asArray(group.listingIds).filter(
    (item): item is number | string =>
      typeof item === "number" || typeof item === "string"
  );
  return {
    listingIds: listingIds.length ? listingIds : undefined,
    skillId:
      typeof group.skillId === "string" || typeof group.skillId === "number"
        ? group.skillId
        : undefined,
    skillName: stringValue(group.skillName),
  };
}

function slotsFromGroups(value: unknown): SlotRow[] {
  return asArray(value).flatMap((item) => {
    const group = asObject(item);
    return group ? slotsFromArray(group.slots, groupContext(group)) : [];
  });
}

export function extractSlots(value: unknown): SlotRow[] {
  if (Array.isArray(value)) {
    return slotsFromArray(value);
  }
  const root = asObject(value);
  const nestedData = asObject(root?.data);
  const nestedDataData = asObject(nestedData?.data);
  const roots = [root, nestedData, nestedDataData].filter(Boolean);
  const grouped = roots.flatMap((candidate) =>
    slotsFromGroups(candidate?.slotGroups)
  );
  if (grouped.length) {
    return grouped;
  }

  const candidates = [
    root?.slots,
    root?.data,
    nestedData?.slots,
    nestedData?.data,
    nestedDataData?.slots,
  ];
  for (const candidate of candidates) {
    const slots = slotsFromArray(candidate);
    if (slots.length) {
      return slots;
    }
  }
  return [];
}

export function isActionableSlot(slot: SlotRow): boolean {
  if (slot.isFull === true) {
    return false;
  }
  return slot.slotsLeft === undefined || slot.slotsLeft > 0;
}

export function extractActionableSlots(value: unknown): SlotRow[] {
  return extractSlots(value).filter(isActionableSlot);
}
