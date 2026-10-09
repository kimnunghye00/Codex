The self-signed localhost certificate and private key are public test fixtures.
They are not deployment credentials. Only the unit test constructs a client
trust store for this certificate; normal browsing continues to use webpki roots.
The test server binds loopback on an ephemeral port and never serves user data.
