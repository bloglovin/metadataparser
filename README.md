# Metadataparser

### The flow to update the Lambda method

1. Do an `npm install`.
2. When the dependencies has been installed, zip the folder into a zip-file where the folder itself is included. When Amazon unzips it the handler should be `metadataparser/index.fetchBatch`. One way to do this is to right-click the folder on OS X and chose to *compress* it.
3. Go to the [AWS Console for OGFetch](https://console.aws.amazon.com/lambda/home?region=us-east-1#/test/http/ogfetch) and upload the zip-file.
4. Done. It can take a short while for the new code to reach all the Lambda servers, but that's to be expected and something that happens on our own infrastructure as well.
