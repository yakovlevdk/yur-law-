declare global {
    var authCodes: Map<string, {
        email?: string;
        phone?: string;
        expiresAt: Date;
    }> | undefined;
}
export {};
//# sourceMappingURL=index.d.ts.map