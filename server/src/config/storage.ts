export const storage = {
    upload: async (key: string, file: Buffer, contentType: string) => {
        return `https://storage.example.com/${key}`;
    },
    delete: async (key: string) => {
        return true;
    },
    getSignedUrl: async (key: string) => {
        return `https://storage.example.com/${key}?token=mock`;
    }
};
