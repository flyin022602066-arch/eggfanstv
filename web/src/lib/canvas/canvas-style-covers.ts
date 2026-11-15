import generatedStyleCovers from "./generated-style-covers.json";

export type GeneratedStyleCover = {
    imageUrl: string;
    thumbnailUrl: string;
    width: number;
    height: number;
};

export const builtinStyleCovers: Readonly<Record<string, GeneratedStyleCover>> = generatedStyleCovers;

export function builtinStyleCover(presetId: string): GeneratedStyleCover | undefined {
    return builtinStyleCovers[presetId];
}
