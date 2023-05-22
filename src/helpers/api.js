const https = require('https');
const _ = require('lodash');
const axios = require('axios');
const {} = require('../utils/cmdPrint');

function extractGPTMessageFromStreamData(input) {
    const regex = /data: (.*?)\n/g;
    const substrings = [];
    let match;

    while ((match = regex.exec(input)) !== null) {
        substrings.push(match[1]);
    }

    return substrings.map(s => JSON.parse(s));
}

function setOptions({protocol, hostname, port, path, method, headers}) {
    let options = {
        protocol: protocol || 'https',
        hostname: hostname || 'api.pythagora.io',
        port: port || process.env.PORT,
        path: path || '/',
        method: method || 'POST',
        headers: headers || {
            'Content-Type': 'application/json',
            'apikey': process.env.OPENAI_API_KEY || process.env.PYTHAGORA_API_KEY,
            'apikeytype': process.env.OPENAI_API_KEY ? 'openai' : 'pythagora'
        },
    };

    if (!options.port) delete options.port;
    return options
}

async function makeRequest(data, options) {
    let gptResponse = '';

    return new Promise((resolve, reject) => {
        const req = https.request(_.omit(options, ['protocol']), function(res){
            res.on('data', (chunk) => {
                try {
                    let stringified = chunk.toString();
                    try {
                        let json = JSON.parse(stringified);
                        if (json.error) gptResponse = json.error;
                        return;
                    } catch (e) {}
                    let receivedMessages = extractGPTMessageFromStreamData(stringified);
                    receivedMessages.forEach(rm => {
                        let content = _.get(rm, 'choices.0.delta.content');
                        if (content) {
                            gptResponse += content;
                            process.stdout.write(content);
                        }
                    });

                } catch (e) {}
            });
            res.on('end', async () => {
                if (res.statusCode >= 400) throw new Error(`Response status code: ${res.statusCode}.`);
                if (gptResponse.message) throw new Error(`Error: ${gptResponse.message}. Code: ${gptResponse.code}`);
                gptResponse = cleanupGPTResponse(gptResponse);
                resolve(gptResponse);
            });
        });

        req.on('error', (e) => {
            console.error("problem with request:"+e.message);
            reject(e);
        });

        req.write(data);

        req.end();
    });
}

async function getJestAuthFunction(loginMongoQueriesArray, loginRequestBody, loginEndpointPath) {
    jestAuthFileGenerationLog();

    let options = setOptions({path: '/generate-jest-auth'});
    return await makeRequest(JSON.stringify({loginMongoQueriesArray, loginRequestBody, loginEndpointPath}), options);
}


async function getJestTest(test) {
    let options = setOptions({path: '/generate-jest-test'});
    return await makeRequest(JSON.stringify(test), options);
}

async function getJestTestName(jestTest, usedNames) {
    let options = setOptions({path:'/generate-jest-test-name'});
    return await makeRequest(JSON.stringify({test: jestTest}), options);
}

async function isEligibleForExport(jestTest) {
    try {
        let options = setOptions({ path: '/check-if-eligible' });

        const response = await axios.post(
            `${options.protocol}://${options.hostname}:${options.port}${options.path}`,
            JSON.stringify({ jestTest }),
            { headers: options.headers }
        );

        return response.data;
    } catch (error) {
        console.log(error);
        return false;
    }
}

function cleanupGPTResponse(gptResponse) {
    if (gptResponse.substring(0, 3) === "```") {
        gptResponse = gptResponse.substring(gptResponse.indexOf('\n') + 2, gptResponse.lastIndexOf('```'));
    }

    return gptResponse;
}

module.exports = {
    getJestAuthFunction,
    getJestTest,
    getJestTestName,
    isEligibleForExport,
    cleanupGPTResponse
}
