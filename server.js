const express = require('express');
const dotenv = require('dotenv');
const http = require("http");
const qs = require("qs");
const axios = require('axios');
const session = require('express-session');
const cors = require("cors");
const app = express();
const AWS = require("aws-sdk");
const port = 4000;

dotenv.config();

const aws_region = process.env.aws_region;
const aws_accessKeyId = process.env.aws_accessKeyId;
const aws_secretAccessKey = process.env.aws_secretAccessKey;
const client_id = process.env.db_client_id;
const redirect_uri = 'http://localhost:4000/redirect';
const token_uri = 'https://kauth.kakao.com/oauth/token';
const api_host = "https://kapi.kakao.com";
const client_secret = '';
const docClient = new AWS.DynamoDB.DocumentClient();

// AWS SDK를 DynamoDB Local에 연결하기 위해 endpoint를 설정합니다.
AWS.config.update({
    region: aws_region, // 지역(region)은 local로 설정합니다.
    accessKeyId: aws_accessKeyId, // 로컬 환경에서 더미(dummy) 액세스 키를 사용합니다.
    secretAccessKey: aws_secretAccessKey, // 로컬 환경에서 더미(dummy) 시크릿 액세스 키를 사용합니다.
});

app.use(session({
    secret: 'your session secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

let corsOptions = {
    origin: '*',
    credentials: true
}
app.use(cors(corsOptions));


// 로그인 메인 화면
app.get('/', function (req, res) {
    res.sendFile(__dirname + '/public/views/index.html');
})

// 테스트 용도
app.get("/add", (req, res) => {
    addItem("user", 1, "1@abc");
})

app.get("/get", (req, res) => {
    getItem("user", 1, "1@abc");
})

app.get("/scan", (req, res) => {
    scanItem("user");
})

app.get("/del", (req, res) => {
    deleteFirstItem("user");
})

// // 서버2 주소
// const SERVER2_URL = "http://:3000";

// // 서버 1의 라우트 핸들러
// app.get('/4to3', async (req, res) => {
//     try {
//         // 서버 2로 GET 요청 보내기
//         const responseFromServer2 = await axios.get(`${SERVER2_URL}/hi2`);
//         const responseData = responseFromServer2.data;
//         res.send(`서버 1에서 서버 2로 요청을 보냈습니다. 응답 데이터: ${responseData}`);
//     } catch (error) {
//         console.error('서버 2 요청 에러:', error);
//         res.status(500).send('서버 2 요청 에러 발생');
//     }
// });


// 권한 확인
app.get('/authorize', function (req, res) {
    let { scope } = req.query;
    var scopeParam = "";
    if (scope) {
        scopeParam = "&scope=" + scope;
    }
    res.status(302).redirect(`https://kauth.kakao.com/oauth/authorize?client_id=${client_id}&redirect_uri=${redirect_uri}&response_type=code${scopeParam}`);
})

// 인증 후 로그인 하는 단계
app.get('/redirect', async function (req, res) {
    const param = qs.stringify({
        "grant_type": 'authorization_code',
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "client_secret": client_secret,
        "code": req.query.code
    });
    
    const header = { 'content-type': 'application/x-www-form-urlencoded' };
    var rtn = await call('POST', token_uri, param, header);
    req.session.key = rtn.access_token;
    profile(req.session.key);
    res.status(302).redirect(`http://localhost:4000`);
    console.log(rtn);
})

// 사용자 프로필 조회
app.get('/profile', async function (req, res) {
    const uri = api_host + "/v2/user/me";
    const param = {};
    const header = {
        'content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Bearer ' + req.session.key
    }
    var rtn = await call('POST', uri, param, header);
    res.send(rtn);
})

// 친구?
app.get('/friends', async function (req, res) {
    const uri = api_host + "/v1/api/talk/friends";
    const param = null;
    const header = {
        'Authorization': 'Bearer ' + req.session.key
    }
    var rtn = await call('GET', uri, param, header);
    res.send(rtn);
})

// 메세지?
app.get('/message', async function (req, res) {
    const uri = api_host + "/v2/api/talk/memo/default/send";
    const param = qs.stringify({
        "template_object": '{' +
        '"object_type": "text",' +
        '"text": "텍스트 영역입니다. 최대 200자 표시 가능합니다.",' +
        '"link": {' +
        '    "web_url": "https://developers.kakao.com",' +
        '    "mobile_web_url": "https://developers.kakao.com"' +
        '},' +
        '"button_title": "바로 확인"' +
        '}'
    });
    const header = {
        'content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Bearer ' + req.session.key
    }
    var rtn = await call('POST', uri, param, header);
    res.send(rtn);
})

let user_id;
let user_email;


// 엑세스 토큰을 가지고 유저 정보 가져오는 함수인 듯
async function call(method, uri, param, header) {
    try {
        rtn = await axios({
            method: method,
            url: uri,
            headers: header,
            data: param
        })
    } catch (err) {
        rtn = err.response;
    }
    return rtn.data;
}

// 유저 정보 받아오는 함수
const profile = async (key) => {
    const uri = api_host + "/v2/user/me";
    const param = {};
    const header = {
        'content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Bearer ' + key
    }
    var rtn = await call('POST', uri, param, header);
    
    user_id = rtn.id;
    user_email = rtn.kakao_account.email;

    console.log(rtn);

    console.log(user_id, user_email, "수신 완료");
}

// 로컬 DynamoDB에 데이터를 추가하는 함수
const addItem = async (tableName, id_val, email_val) => {
    const params = {
        TableName: tableName, // 로컬 DynamoDB 테이블 이름 (테이블은 미리 생성되어 있어야 합니다)
        Item: {
            user_id: id_val,
            user_email: email_val // 기본 키 필드 (해당 테이블의 기본 키에 맞게 설정해야 합니다)
        },
    };
    try {
        await docClient.put(params).promise();
        console.log("Item added successfully!");
        return true;
    } catch (err) {
        console.error("Error adding item:", err);
        return false;
    }
}

// 로컬 DynamoDB에 데이터를 조회하는 함수
const getItem = async (tableName, id_val, email_val) => {
    const params = {
        TableName: tableName,
        Key: {
            user_id: id_val,
            user_email: email_val,
        },
    };
    try {
        const data = await docClient.get(params).promise();
        
        console.log("Item retrieved successfully:", data.Item);
        
        return true;
    } catch (err) {
        console.error("Error getting item:", err);
        
        return false;
    }
}

// 로컬 DynamoDB 테이블에 있는 모든 데이터를 조회하는 함수
const scanItem = async (tableName) => {
    const params = {
        TableName: tableName,
    };
    
    try {
        const data = await docClient.scan(params).promise();
        
        console.log("Item retrieved successfully:", data.Items);
    } catch (err) {
        console.error("Error getting item:", err);
    }
}

// 로컬 DynamoDB의 테이블 데이터 맨 위 인덱스 값을 삭제하는 함수
const deleteFirstItem = async (tableName) => {
    const params = {
        TableName: tableName
    };

    try {
        const data = await docClient.scan(params).promise();
        console.log("Items scan successfully:", data.Items);
        
        if (data.Items.length > 0) {
            const firstItemPrimaryKey = {
                user_id: data.Items[0].user_id,
                user_email: data.Items[0].user_email
            };
            
            // 첫 번째 데이터를 삭제합니다.
            await docClient.delete({
                TableName: tableName,
                Key: firstItemPrimaryKey
            }, (deleteErr, deleteData) => {
                if (deleteErr) {
                    console.error('Error deleting item:', deleteErr);
                } else {
                    console.log('Item deleted successfully.');
                }
            });
        } else {
            console.log('No data found in the table.');
        }
        
        console.log("Item deleted successfully:", data.Items);
    } catch (err) {
        console.error("Error delete item:", err);
    }
}

// 서버 - 포트 연결
app.listen(port, () => {
    console.log(`Listening on port: http://localhost:${port}`);
})