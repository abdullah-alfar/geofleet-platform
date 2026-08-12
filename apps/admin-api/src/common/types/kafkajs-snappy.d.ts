declare module 'kafkajs-snappy' {
  // Matches kafkajs's own CompressionCodecs[CompressionTypes.Snappy] shape
  // (`() => any` in kafkajs/types/index.d.ts) — kafkajs-snappy ships no
  // types of its own.
  const SnappyCodec: () => unknown;
  export default SnappyCodec;
}
