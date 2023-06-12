const _ = require('lodash');
const axios = require('axios');
const { jestAuthFileGenerationLog } = require('../utils/cmdPrint');
const { bold, reset, red, blue } = require('../utils/cmdPrint').colors;
const args = require('../utils/getArgs.js');
const {PYTHAGORA_UNIT_TESTS_VERSION,PYTHAGORA_API_SERVER} = require('../const/common');
const API_SERVER = args.pythagora_api_server || PYTHAGORA_API_SERVER;

function extractGPTMessageFromStreamData(input) {
    const regex = /data: (.*?)\n/g;
    const substrings = [];
    let match;

    while ((match = regex.exec(input)) !== null) {
        substrings.push(match[1]);
    }

    return substrings.map(s => JSON.parse(s));
}

function setOptions({path, method, headers}) {
    let apiKey = args.openai_api_key || args.pythagora_api_key;
    const parsedUrl = new URL(API_SERVER);
    if (!apiKey) throw new Error('No API key provided. Please add --openai-api-key or --pythagora-api-key')
    let options = {
        protocol: parsedUrl.protocol.replace(':', ''),
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: path || '/',
        method: method || 'POST',
        headers: headers || {
            'Content-Type': 'application/json',
            'apikey': apiKey,
            'apikeytype': args.openai_api_key ? 'openai' : 'pythagora'
        },
    };

    if (!options.port) delete options.port;
    return options
}

async function makeRequest(data, options, customLogFunction) {
    let gptResponse = '';
    let end = false;
    let httpModule = options.protocol === 'http' ? require('http') : require('https');

    return new Promise((resolve, reject) => {
        const req = httpModule.request(_.omit(options, ['protocol']), function(res){
            res.on('data', (chunk) => {
                try {
                    let stringified = chunk.toString();
                    try {
                        let json = JSON.parse(stringified);
                        if (json.error || json.message) gptResponse = json;
                        return;
                    } catch (e) {}

                    if (!stringified.includes('pythagora_end:')) {
                        let receivedMessages = extractGPTMessageFromStreamData(stringified);
                        receivedMessages.forEach(rm => {
                            let content = _.get(rm, 'choices.0.delta.content');
                            if (content) {
                                gptResponse += content;
                                if (customLogFunction) customLogFunction(gptResponse);
                                else process.stdout.write(content);
                            }
                        });
                    } else {
                        gptResponse += stringified;
                        if (customLogFunction) customLogFunction(gptResponse);
                        else process.stdout.write(stringified);
                    }
                } catch (e) {}
            });
            res.on('end', async function ()  {
                process.stdout.write('\n');
                if (res.statusCode >= 400) throw new Error(`Response status code: ${res.statusCode}. Error message: ${gptResponse}`);
                if (gptResponse.message) throw new Error(`Error: ${gptResponse.message}. Code: ${gptResponse.code}`);
                gptResponse = cleanupGPTResponse(gptResponse.split('pythagora_end:').pop());
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

async function getUnitTests(data, customLogFunction) {
    let options = setOptions({path: '/api/generate-unit-tests'});
    let resp = await makeRequest(JSON.stringify(data), options, customLogFunction);
    return resp;
}

async function getJestAuthFunction(loginMongoQueriesArray, loginRequestBody, loginEndpointPath) {
    jestAuthFileGenerationLog();

    let options = setOptions({path: '/api/generate-jest-auth'});
    return await makeRequest(JSON.stringify({loginMongoQueriesArray, loginRequestBody, loginEndpointPath}), options);
}


async function getJestTest(test) {
    let options = setOptions({path: '/api/generate-jest-test'});
    return await makeRequest(JSON.stringify(test), options);
}

async function getJestTestName(test, usedNames) {
    let options = setOptions({path:'/api/generate-jest-test-name'});
    return await makeRequest(JSON.stringify({ test }), options);
}

async function isEligibleForExport(test) {
    try {
        let options = setOptions({ path: '/api/check-if-eligible' });

        const response = await axios.post(
            `${options.protocol}://${options.hostname}${options.port ? ':' + options.port : ''}${options.path}`,
            JSON.stringify({ test }),
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
        gptResponse = gptResponse.substring(gptResponse.indexOf('\n') + 1, gptResponse.lastIndexOf('```'));
    }

    return gptResponse;
}

function checkForAPIKey() {
    if (!args.pythagora_api_key && !args.openai_api_key) {
        console.log(`${bold+red}No API key found!${reset}`);
        console.log('Please run:')
        console.log(`${bold+blue}npx pythagora --config --pythagora-api-key <YOUR_PYTHAGORA_API_KEY>${reset}`);
        console.log('or')
        console.log(`${bold+blue}npx pythagora --config --openai-api-key <YOUR_OPENAI_API_KEY>${reset}`);
        console.log(`You can get Pythagora API key here: https://mailchi.mp/f4f4d7270a7a/api-waitlist`);
        process.exit(0);
    }
}

module.exports = {
    getJestAuthFunction,
    getJestTest,
    getJestTestName,
    isEligibleForExport,
    cleanupGPTResponse,
    getUnitTests,
    checkForAPIKey
}