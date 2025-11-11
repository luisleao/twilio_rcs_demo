
require('dotenv').config();

const express = require('express');
const app = new express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('output'));

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { Timestamp, FieldValue } = require("firebase-admin/firestore");




const firebaseConfig = {
    credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    })
}
const firebase = require('firebase-admin');
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
} else {
    firebase.app(); // if already initialized, use that one
}
const db = firebase.firestore();



let messageHistory = [];


const PROMPT = `
        Você é um guia turístico que ajuda pessoas a criarem roteiros e propor atividades dependendo da localização que o usuário te enviar.
        Ao receber uma localização geográfica, retorne a região que foi informada e comece a conversar com o usuário pedindo preferências para que possa refinar sua proposta.
        Você pode sugerir roteiros, atrações ou ambos. Caso recomende algum lugar, informe também sobre a expectiva de custo do lugar recomendado.
        Como a conversa acontece através de um aplicativo de mensagens, você deve sempre ser mais breve possível e evitar enviar textos muito longos e não utilizar muitos emojis.
        Não formate o texto em markdown e não use formatações com **!
        Foque em apenas uma dica por vez e não liste múltiplas opções de uma vez só.
        Chame a função send_highlights caso o usuário peça por sugestões de pontos turísticos ou atrações de destaque.
        Caso o usuário faça uma pergunta, considere o histórico de mensagens a última localização que foi enviada. Caso não tenha nenhum destaque específico enviado, você pode sugerir que o usuário envie uma localização para que você possa ajudar melhor ou informe o local onde ele está.
    `

messageHistory.push(
    {
        role: "system",
        content: [
            { type: "input_text", text: PROMPT },

        ],
    }
);

// https://platform.openai.com/assistants/edit?assistant=asst_9qCqeNSfVvuTlOBP97sWtBvR&thread=thread_KcPViy8niTYCDp0bnKivI9am


const twilio = require('twilio');
const {
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
    OPENAI_API_KEY,
    MESSAGE_SERVICE_SID,
    RCS_AGENT,
    NUMERO_RCS,
    NUMERO_PESSOAL,

    DESTAQUE_TEMPLATE_SID,
    LOCAL_TEMPLATE_SID
} = process.env;


const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const { downloadTwilioMedia } = require('./utils');


const sendPlaceDetails = async (to, from, place) => {

    return await twilioClient.messages.create({
        from: from,
        to: to,
        messagingServiceSid: `MG508c8549b6b658a437810445e255ea7e`,
        contentSid: LOCAL_TEMPLATE_SID,
        contentVariables: JSON.stringify({
            placeName: place.name,
            placeDetail: place.detail,
            placeImage: place.image,
            placeGoogleMapsLink: `https://www.google.com/maps/search/?api=1&query=${place.Latitude},${place.Longitude}`,
            placeLink: 'https://www.twilio.com/pt-br/lp/rcs-sales',
        })
    });
}


app.post('/message', async (req, res) => {

    const twiml = new twilio.twiml.MessagingResponse();
    const message = req.body;

    const hasGeolocation = message.Latitude && message.Longitude;
    const hasMedia = message.NumMedia && parseInt(message.NumMedia) > 0;


    // retrieve from /demo/rcsdemo/{md5(message.From)}/history the message history using md5 library
    const md5 = require('md5');
    
    const userRef = db.collection('demo').doc('rcsdemo').collection('history').doc(md5(message.From));
    const historySnapshot = await userRef.get();
    if (historySnapshot.exists) {
        const historyData = historySnapshot.data();
        if (historyData.removeAt) {
            const now = Timestamp.now();
            if (now.seconds > historyData.removeAt.seconds) {
                historyData.messages = [];
                return;
            }
        }
        messageHistory = historyData.messages || [];
    } else {
        messageHistory = [];
    }

    await userRef.collection('messages').add(message);

    console.log('messageHistory', messageHistory);

    if (message.ButtonPayload) {
        const [command, itemId] = message.ButtonPayload.split('_');
        switch (command) {
            case 'STOP':
                twiml.message(`Lamentamos que não queira mais receber mensagens.\nSeu número foi removido da nossa lista!\n\nCaso tenha interesse retornar, envie uma mensagem para continuar.`);
                res.send(twiml.toString());
                return;

            case "DESTAQUE":
                res.send(twiml.toString());
                if (!itemId) {
                    await twilioClient.messages.create({
                        from: message.To,
                        to: message.From,
                        // messagingServiceSid: `MG508c8549b6b658a437810445e255ea7e`,
                        contentSid: DESTAQUE_TEMPLATE_SID,
                        contentVariables: JSON.stringify({ 1: 'tourismlogorcs' }),
                    });
                    return;
                }

                let messageItem = null; 

                switch (itemId) {
                    case 'NORONHA':
                        // enviar detalhes do item 1
                        messageItem = {
                            name: 'Fernando de Noronha',
                            detail: 'Um arquipélago paradisíaco conhecido por suas praias deslumbrantes, vida marinha rica e atividades de mergulho excepcionais.',
                            image: 'https://twil.io/rcsdemo-noronha',
                            Latitude: -3.8572,
                            Longitude: -32.4295
                        }
                        break;
                    case 'IBIRAPUERA':
                        // enviar detalhes do item 2
                        messageItem =  {
                            name: 'Parque Ibirapuera',
                            detail: 'Um dos parques mais famosos de São Paulo, ideal para caminhadas, piqueniques e atividades ao ar livre.',
                            image: 'https://twil.io/rcsdemo-ibirapuera',
                            Latitude: -23.587416,
                            Longitude: -46.657634
                        };
                        break;

                    case 'CRISTO':
                        // enviar detalhes do item 3
                        messageItem = {
                            name: 'Cristo Redentor',
                            detail: 'Uma das sete maravilhas do mundo moderno, esta estátua icônica oferece vistas panorâmicas do Rio de Janeiro.',
                            image: 'https://twil.io/rcsdemo-cristo',
                            Latitude: -22.9519,
                            Longitude: -43.2105
                        };
                        break;
                    // adicionar mais casos conforme necessário
                }

                if (messageItem) {
                        await sendPlaceDetails(message.From, message.To, messageItem);
                        // save messageHistory to firestore
                        messageHistory.push({
                            role: "assistant",
                            content: [
                                { type: "output_text", text: `Enviei os detalhes sobre ${messageItem.name} para você!\n\n\n${JSON.stringify(messageItem)}` }
                            ],
                        });
                        await userRef.set({
                            messages: messageHistory,
                            removeAt: Timestamp.now() + 1 * 24 * 60 * 60 // clean in 1 day
                        }, { merge: true });
                        
                }
                return;

        }
    }


    if (hasMedia) {
        console.log('media received', message.NumMedia, message.MediaContentType0, message.MediaUrl0);
        twiml.message('No momento não estamos recebendo arquivos de mídia.\n\nPor favor, envie apenas mensagens de texto ou uma localização.');
        return res.send(twiml.toString());
    }

    console.log('new message!!!', req.body);

    if (hasGeolocation) {
        console.log('location received', message.Latitude, message.Longitude);
    }


    const { OpenAI } = require('openai');
    const openai = new OpenAI({
        apiKey: OPENAI_API_KEY
    });


    if (hasGeolocation) {
        messageHistory.push({
            role: "user",
            content: [
                { type: "input_text", text: `A localização do usuário é Latitude: ${message.Latitude}, Longitude: ${message.Longitude}` },
                {
                    type: "input_location",
                    latitude: parseFloat(message.Latitude),
                    longitude: parseFloat(message.Longitude),
                },
            ],
        });
    } else {
        messageHistory.push({
            role: "user",
            content: [
                { type: "input_text", text: req.body.Body },
            ],
        });
    }

    const tools = [
        {
            type: "function",
            name: "send_highlights",
            function: {
                description: "Send a list of featured tourist destinations to the user",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        }
    ];

    const response = await openai.responses.create({
        model: "gpt-4o-mini",
        input: messageHistory,
        tools: tools,
    });

    // Check if the model wants to call the send_highlights function
    if (response.output && response.output.some(output => output.type === "function_call")) {
        const functionCall = response.output.find(output => output.type === "function_call");
        
        if (functionCall && functionCall.name === "send_highlights") {
            // Send the highlights template
            await twilioClient.messages.create({
                from: message.To,
                to: message.From,
                contentSid: DESTAQUE_TEMPLATE_SID,
                contentVariables: JSON.stringify({ 1: 'tourismlogorcs' }),
            });
            
            // Add a follow-up message to conversation history
            messageHistory.push({
                role: "assistant",
                content: [
                    { type: "input_text", text: "Enviei alguns destaques para você!" }
                ],
            });
                        
            res.send(twiml.toString());
            return;
        }
    } else {
        console.log('response', response);
        messageHistory.push({
            role: "assistant",
            content: response.output_text[0].content // remove markdown bold,
        });

        await twilioClient.messages.create({
            from: message.To,
            to: message.From,
            messagingServiceSid: `MG508c8549b6b658a437810445e255ea7e`,

            body: response.output_text.split('**').join('') // remove markdown bold,
        });
    }


    console.log('messageHistory', messageHistory)
    // save messageHistory to firestore
    await userRef.set({
        messages: messageHistory,
        removeAt: Timestamp.now() + 1 * 24 * 60 * 60 // clean in 1 day
    }, { merge: true });





    /*
        Você é um guia turístico que ajuda pessoas a criarem roteiros e propor atividades dependendo da localização que o usuário te enviar.
        Ao receber uma localização geográfica, retorne a região que foi informada e comece a conversar com o usuário pedindo preferências para que possa refinar sua proposta.
        Você pode sugerir roteiros, atrações ou ambos. Caso recomende algum lugar, informe também sobre a expectiva de custo do lugar recomendado. Você pode usar exemplos mais lúdicos como $ até $$$$.
        Como a conversa acontece através de um aplicativo de mensagens, você deve sempre ser mais breve possível e evitar enviar textos muito longos.
        Você pode utilizar conteúdos ricos, como carrosséis e botões de auto-resposta. O carrossel o limite deve ser de 5 items e os botões de resposta até 3 items.

        Retorne sempre cada chamada do usuário com um formato de json conforme a seguir, considerando como base https://www.twilio.com/docs/content/carousel:
        {
            resposta: <corpo de resposta>
            tipo: <texto, carrossel, imagem, location, autoreply>
            location: {
                lat: <latitude>,
                lng: <longitude>
            },
            carrossel: [
                {
                    title: <titulo>,
                    body: <corpo do carrossel>,
                    texto: <texto do carrossel>
                    media: <url da imagem>,
                    actions: [
                        {
                            "type":"QUICK_REPLY",
                            "title":"I want it!",
                            "id":"want_hat"
                        },
                        {
                            "type":"URL",
                            "title":"Hand me the hat!",
                            "url":"https://sienna-grasshopper-3262.twil.io/assets/hat.jpeg"
                        },
                        {
                            "type":"PHONE_NUMBER",
                            "title":"Hand me the hat!",
                            "phone":"phone number"
                        },

                        
                    ]
                }
            ]
        } 
    */

    /*
    if (req.body.MessageType == 'image') {

        twiml.message('Your picture will be processed in a few minutes.');
        res.send(twiml.toString());

        const base64Image = await downloadTwilioMedia(req.body.MediaUrl0);

        console.log('base64', base64Image);

        const PROMPT = `make me look like a cartoon. please ignore the background and focus only on the person or persons in front`;

        // const { OpenAI } = require('openai');
        // const openai = new OpenAI({
        //     apiKey: OPENAI_API_KEY
        // });

        // const response = await openai.responses.create({
        //     model: "gpt-4o-mini",
        //     input: [
        //         {
        //             role: "user",
        //             content: [
        //                 { type: "input_text", text: PROMPT },
        //                 {
        //                     type: "input_image",
        //                     image_url: `data:${base64Image.contentType};base64,${base64Image.base64}`,
        //                 },
        //             ],
        //         },
        //     ],
        //     tools: [{ type: "image_generation" }],
        // });

        // console.log('response', response);

        // const imageData = response.output
        //     .filter((output) => output.type === "image_generation_call")
        //     .map((output) => output.result);

        // if (imageData.length > 0) {
        //     const imageBase64 = imageData[0];
        //     const fs = await import("fs");
        //     fs.writeFileSync(`output/${req.body.SmsMessageSid}.png`, Buffer.from(imageBase64, "base64"));

        //     // Send whatsapp message with image
        //     const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        //     await twilioClient.messages.create({
        //         from: req.body.To,
        //         to: req.body.From, 
        //         body: `Here is your picture`,
        //         mediaUrl: `${req.protocol}://${req.headers['x-forwarded-host']}/${req.body.SmsMessageSid}.png`
        //     })

        // } else {
        //     console.log(response.output.content);
        // }

    */

});


app.get('/', async (req, res) => {
    res.send('OK');

    // await twilioClient.messages.create({
    //     // from: RCS_AGENT,
    //     // to: `rcs:${NUMERO_PESSOAL}`,
    //     to: `${NUMERO_PESSOAL}`,
    //     messagingServiceSid: `MG508c8549b6b658a437810445e255ea7e`,
    //     contentSid: 'HX35de91b4c0cad1474133320ed84f22b4',
    //     // contentVariables: ''
    //     contentVariables: JSON.stringify({1: 'tourismlogorcs'}),
    //     // body: 'Hello from RCS via Twilio!',
    // }).then(m => {
    //     console.log('message sent', m.sid);
    // });


});



app.get('/teste', async (req, res) => {
    res.sendFile(__dirname + '/public/mensagem.html');
    const numero = req.query.numero;

    res.send(`enviando mensagem para ${numero}`);

    await twilioClient.messages.create({
        // from: RCS_AGENT,
        // to: `rcs:${NUMERO_RCS}`,
        to: `${numero}`,
        messagingServiceSid: `MG508c8549b6b658a437810445e255ea7e`,
        contentSid: 'HX35de91b4c0cad1474133320ed84f22b4',
        // contentVariables: ''
        contentVariables: JSON.stringify({1: 'tourismlogorcs'}),
        // body: 'Hello from RCS via Twilio!',
    }).then(m => {
        console.log('message sent', m.sid);
    });

});

app.use(express.static('public'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});





(async () => {

    console.log('sending rcs message', TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, MESSAGE_SERVICE_SID, NUMERO_RCS, RCS_AGENT, NUMERO_PESSOAL);

    // const message = await twilioClient.messages.create({
    //     from: RCS_AGENT,
    //     to: `rcs:${NUMERO_RCS}`,
    //     messagingServiceSid: `MG508c8549b6b658a437810445e255ea7e`,
    //     contentSid: 'HX35de91b4c0cad1474133320ed84f22b4',
    //     // contentVariables: ''
    //     contentVariables: JSON.stringify({1: 'tourismlogorcs'}),
    //     // body: 'Hello from RCS via Twilio!',
    // });
    // console.log('message_sid', message.sid);


    // const message = await sendPlaceDetails(NUMERO_RCS, RCS_AGENT, {
    //     name: 'Cristo Redentor',
    //     detail: `Uma das sete maravilhas do mundo moderno, esta estátua icônica oferece vistas panorâmicas do Rio de Janeiro.\n\nExpectativa de custo: $$`,
    //     image: 'https://leao.ngrok.io/images/tourism-header.png',
    //     Latitude: -22.9519,
    //     Longitude: -43.2105
    // });
    // console.log('message_sid', message.sid);




    // await twilioClient.messages.create({
    //     // from: RCS_AGENT,
    //     // to: `rcs:${NUMERO_PESSOAL}`,
    //     to: `+5511963875373`, // Ze
    //     messagingServiceSid: `MG508c8549b6b658a437810445e255ea7e`,
    //     contentSid: 'HX35de91b4c0cad1474133320ed84f22b4',
    //     // contentVariables: ''
    //     contentVariables: JSON.stringify({1: 'tourismlogorcs'}),
    //     // body: 'Hello from RCS via Twilio!',
    // }).then(m => {
    //     console.log('message sent', m.sid);
    // });

})();
