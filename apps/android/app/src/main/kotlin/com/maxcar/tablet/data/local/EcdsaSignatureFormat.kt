package com.maxcar.tablet.data.local

/**
 * MAX-010.6 correction: `SHA256withECDSAinP1363Format` — the algorithm name
 * this project originally assumed would make Android sign directly in the
 * raw IEEE P1363 r‖s format the server (Deno's Web Crypto, which has no DER
 * support at all) requires — does not exist on any security provider on
 * real Android (confirmed via an instrumented test on physical hardware,
 * Android 15/API 35: `AndroidKeyStore`, `AndroidKeyStoreBCWorkaround`, and
 * `AndroidOpenSSL` all throw `NoSuchAlgorithmException` for it). It only
 * ever worked in this project's own tests because the desktop JVM
 * (OpenJDK's SunEC provider) *does* register that algorithm name — every
 * unit/Robolectric test signs on the desktop JVM, so none of them could
 * have caught this; only physical instrumented testing did.
 *
 * The fix: sign with the universally-supported standard algorithm name
 * (`SHA256withECDSA`, DER-encoded `SEQUENCE { INTEGER r, INTEGER s }`) and
 * convert to raw r‖s here, in Kotlin, instead of asking the platform to
 * produce a format it doesn't actually implement. The server side is
 * unchanged — it already expects and only ever expected raw r‖s bytes.
 */
object EcdsaSignatureFormat {
    /** The real, standard JCA algorithm name every Android provider
     * actually supports for EC signing — never the P1363 variant. */
    const val JCA_ALGORITHM = "SHA256withECDSA"

    /** Converts a DER-encoded ECDSA signature (`SEQUENCE { INTEGER r,
     * INTEGER s }`) to the fixed-size raw r‖s format — 2×[componentSize]
     * bytes, big-endian, unsigned, zero-padded (or with a leading
     * DER-mandated sign-guard zero byte stripped) to exactly
     * [componentSize] each. [componentSize] is 32 for P-256. */
    fun derToRaw(der: ByteArray, componentSize: Int = 32): ByteArray {
        require(der.isNotEmpty() && der[0] == SEQUENCE_TAG) { "Not a DER SEQUENCE." }
        var offset = 1
        offset = skipLength(der, offset)

        val (r, afterR) = readInteger(der, offset)
        val (s, _) = readInteger(der, afterR)

        return fixedSize(r, componentSize) + fixedSize(s, componentSize)
    }

    /** Converts a raw r‖s signature (2×[componentSize] bytes) back to DER —
     * only used by tests to round-trip against a reference verifier; the
     * production signing path never needs this direction. */
    fun rawToDer(raw: ByteArray, componentSize: Int = 32): ByteArray {
        require(raw.size == componentSize * 2) { "Raw signature must be exactly ${componentSize * 2} bytes." }
        val r = encodeInteger(raw.copyOfRange(0, componentSize))
        val s = encodeInteger(raw.copyOfRange(componentSize, raw.size))
        val body = r + s
        return byteArrayOf(SEQUENCE_TAG) + encodeLength(body.size) + body
    }

    private fun skipLength(der: ByteArray, offset: Int): Int {
        val first = der[offset].toInt() and 0xFF
        return if (first and 0x80 == 0) {
            offset + 1
        } else {
            offset + 1 + (first and 0x7F)
        }
    }

    private fun readInteger(der: ByteArray, offset: Int): Pair<ByteArray, Int> {
        require(der[offset] == INTEGER_TAG) { "Expected an INTEGER at offset $offset." }
        var pos = offset + 1
        val length = der[pos].toInt() and 0xFF
        pos += 1
        val value = der.copyOfRange(pos, pos + length)
        return value to (pos + length)
    }

    private fun fixedSize(bytes: ByteArray, size: Int): ByteArray {
        // DER INTEGER encoding prepends a 0x00 byte whenever the value's
        // high bit would otherwise be mistaken for a sign flag — strip it
        // if it pushed us over the fixed component size.
        val trimmed = if (bytes.size > size && bytes[0] == 0.toByte()) bytes.copyOfRange(1, bytes.size) else bytes
        return when {
            trimmed.size == size -> trimmed
            trimmed.size < size -> ByteArray(size - trimmed.size) + trimmed
            else -> trimmed.copyOfRange(trimmed.size - size, trimmed.size)
        }
    }

    private fun encodeInteger(component: ByteArray): ByteArray {
        // Strip leading zero bytes, then re-add exactly one 0x00 guard byte
        // if the remaining high bit would otherwise read as negative.
        var trimmed = component
        var start = 0
        while (start < trimmed.size - 1 && trimmed[start] == 0.toByte()) start++
        trimmed = trimmed.copyOfRange(start, trimmed.size)
        val needsGuard = trimmed.isNotEmpty() && (trimmed[0].toInt() and 0x80) != 0
        val value = if (needsGuard) byteArrayOf(0) + trimmed else trimmed
        return byteArrayOf(INTEGER_TAG) + encodeLength(value.size) + value
    }

    private fun encodeLength(length: Int): ByteArray = if (length < 0x80) {
        byteArrayOf(length.toByte())
    } else {
        val bytes = mutableListOf<Byte>()
        var remaining = length
        while (remaining > 0) {
            bytes.add(0, (remaining and 0xFF).toByte())
            remaining = remaining shr 8
        }
        byteArrayOf((0x80 or bytes.size).toByte()) + bytes.toByteArray()
    }

    private const val SEQUENCE_TAG: Byte = 0x30
    private const val INTEGER_TAG: Byte = 0x02
}
