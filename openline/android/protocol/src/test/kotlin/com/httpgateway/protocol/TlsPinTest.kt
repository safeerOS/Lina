package com.httpgateway.protocol

import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

/**
 * Napad: veriga [tuj list, pravi certifikat]. Odtis se ujema z drugim
 * certifikatom, list pa je napadalcev. To mora pasti.
 */
class TlsPinTest {
    private val factory = CertificateFactory.getInstance("X.509")
    private val real = cert(REAL_PEM)
    private val foreign = cert(FOREIGN_PEM)
    private val pin = TlsPin.sha256Hex(real.encoded)

    @Test
    fun `tuj list pred pravim certifikatom je zavrnjen`() {
        assertFailsWith<TlsPin.Rejected> {
            TlsPin.assertLeaf(listOf(foreign.encoded, real.encoded), pin)
        }
    }

    @Test
    fun `pravi list je sprejet tudi ce je za njim tuj certifikat`() {
        TlsPin.assertLeaf(listOf(real.encoded), pin)
        TlsPin.assertLeaf(listOf(real.encoded, foreign.encoded), pin)
    }

    @Test
    fun `prazna veriga ali drug list je zavrnitev`() {
        assertFailsWith<TlsPin.Rejected> { TlsPin.assertLeaf(emptyList(), pin) }
        assertFailsWith<TlsPin.Rejected> { TlsPin.assertLeaf(listOf(foreign.encoded), pin) }
        assertFailsWith<TlsPin.Rejected> { TlsPin.assertLeaf(listOf(real.encoded), "ab") }
    }

    @Test
    fun `zvok brez odtisa ali brez wss se ne odpre`() {
        assertFailsWith<IllegalArgumentException> {
            TlsPin.requireMediaPin("wss://10.0.0.2/v1/device-media", "")
        }
        assertFailsWith<IllegalArgumentException> {
            TlsPin.requireMediaPin("ws://10.0.0.2/v1/device-media", pin)
        }
        assertEquals(pin, TlsPin.requireMediaPin("wss://10.0.0.2/v1/device-media?callId=1", pin.uppercase()))
        assertFalse(TlsPin.normalize("zz").contains('z'))
    }

    private fun cert(pem: String): X509Certificate =
        factory.generateCertificate(pem.byteInputStream()) as X509Certificate

    private companion object {
        val REAL_PEM = """
            -----BEGIN CERTIFICATE-----
            MIIC/zCCAeegAwIBAgIUcviNkmppKLcSY1C0bi/gtc+h5+MwDQYJKoZIhvcNAQEL
            BQAwDzENMAsGA1UEAwwEcmVhbDAeFw0yNjExMDkxOTM3MjVaFw0yNjExMTExOTM3
            MjVaMA8xDTALBgNVBAMMBHJlYWwwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
            AoIBAQC6ihFaJR43/gstkk6vnDWT/cb70e/6u/yLQhX2hSEGAEE7c2Biw9r3o3Nq
            9ghxggCG0lD8MxP9Arofuaw3vC3QTbbpzl4UP855BgqOUZE0pKp9JACY58mUXP+M
            qnsZeJtYK6fz8uMa5K9KHqtE3rwSXCONNOFg2mkOj+elagtlqA6eF2SADhZsXIYq
            +jJWKlqQWXQUWFkKYfmQBCnROflSWBKLz8F/9w5BCw3BrHqTCvoksD50QDtWCd4h
            XX6jPffjCmdOL5S8EGywMQxyi1o5lAKrAoCaIf8a4o2cm1JuaPjKi3Kbtxjc6F3X
            GL6zXSf9YNbvrK350ouv2zS9SqT/AgMBAAGjUzBRMB0GA1UdDgQWBBShVY1Y1MCd
            JrTbEXLeApcKzl6BWTAfBgNVHSMEGDAWgBShVY1Y1MCdJrTbEXLeApcKzl6BWTAP
            BgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQA1KPeBMelp9ZXA+9+E
            3r3IM5mUx9hsnGkAPoWCJvvhPTTcImQq1czjQu7pFK8ZW6gz3hr5e2c3yg6C9lFf
            +lIR9zDqEMwyq7QzLOf7EyKpkeZbtlwSB8XP34W1FgjhWC5MIoPfpIDCxuEQ9wst
            uWTMNSOz0jZhZICeNK903U+9GjoH+M2yAuBsrsNOZNq1oSCH4nj1w/K0FQmCEOEm
            jotlt7UmryL2j2hLUVYWvyP4dnD9PmNwAK2+FEzzgIpK1xr4D3fCFR8QGEzCdfif
            +M7AT1i9zORmmp2PlvWPgD5lCuj8uPfuwOutk1ozdErtOanUe3+tnydxkVrJNZtP
            jdwA
            -----END CERTIFICATE-----
        """.trimIndent()

        val FOREIGN_PEM = """
            -----BEGIN CERTIFICATE-----
            MIIDBTCCAe2gAwIBAgIUb7pUBzALBEIUgp38k3qnvdARN7owDQYJKoZIhvcNAQEL
            BQAwEjEQMA4GA1UEAwwHZm9yZWlnbjAeFw0yNjExMDkxOTM3MjVaFw0yNjExMTEx
            OTM3MjVaMBIxEDAOBgNVBAMMB2ZvcmVpZ24wggEiMA0GCSqGSIb3DQEBAQUAA4IB
            DwAwggEKAoIBAQDQPCT4QJ6GLMR3/v43Xg+iDg1vGB8LEjmXCdbpMeYbY/Eoz2tO
            4gfWHfVN1KivfSHPhOBmoH9mDOcI/Dca4Blf17HlhQ4LE5P+VR7C56ablNksVYG5
            MEaC22qSzimh8ww4H+dS3yg/DrfbavmMMpGR7h7WD9xG/FQyII3jlyt4asjICYBg
            jqnrxTWqTUv4m1DMcCuKJjvH+kj5S6mg6Uv4GdoYn5rlzKoJ+VPYxeVPV1vpKNSF
            rbQYAoRDSpTs7x+wQ91JCgrxy8e3cSav3cmUxaI1iiDh7mvtiZkfy+QK7eIE285W
            NeuvrD6IekSijHnCUlKEWIhG3q2rTilvobAxAgMBAAGjUzBRMB0GA1UdDgQWBBTn
            MyLW8+oubmU1gLzzcYBtV0qMOTAfBgNVHSMEGDAWgBTnMyLW8+oubmU1gLzzcYBt
            V0qMOTAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQCxSFlOskAo
            g5vkwNKxDoBWNkKPhWSBmglIGzNGFHT6nw2J76Vo2a5hhyojEt7718TLYwo6ep/f
            5Lwu7/9ymjf5Vert1TQxEX+/b3aYvYqbfCQ36NzAe5HKKNEWRvlAL1f35t76QFXa
            gp6rgYGMU+37YUpHqApO7oQZ8EyTWLR5U5tensQz7zQ+rk7gCml7vyyKxR8PhsOq
            iXVvtN21U+vYBOdIWD/WOLRxVNXsGgO3HWCVTcKnDNCqilNZf1Fp4FRIosUcsVrb
            qEqh6dLwgGYwsj+A++XKTJNWIUCJAcKQS2JcPhFmAvmRspjqyCMAJAwzdLrd990T
            TYp7U6U1dACI
            -----END CERTIFICATE-----
        """.trimIndent()
    }
}
