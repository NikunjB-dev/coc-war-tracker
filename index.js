require('dotenv').config();
const {Client, IntentsBitField, EmbedBuilder, ActivityType} = require('discord.js');
const {CommandHandler} = require('djs-commander');
const path = require('path');
const mongoose = require('mongoose');
const API = require('clashofclans.js').Client;
const MemberSchema = require('./models/war_data');
const warSchema = require('./models/wars');
const { GoogleSpreadsheet } =  require('google-spreadsheet');
const {JWT} = require('google-auth-library');
const fs = require('fs');
const { channel } = require('diagnostics_channel');




// x-x-x-x-x-x-x-x--x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x






const coc_client = new API({ keys: [process.env.API_KEY] });
var serviceAccountAuth;
var doc;

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
    ],
})




new CommandHandler({
    client: client,
    commandsPath: path.join(__dirname, "commands"),
    eventsPath: path.join(__dirname, "events"),
    validationsPath: path.join(__dirname, "validations"),
    testServer: process.env.GUILD_ID
});


(async() => {
    client.login(process.env.TOKEN);
})();

client.on('ready', async (c) => {
    await connectDB();
    await initSheet();

    await fetchAndLogConfig();
    //await fetchAndLogConfigCWL();
    await saveData();
    const interval2 = setInterval(saveData, 5 * 60 * 1000); // 30 minutes in milliseconds
    const interval = setInterval(fetchAndLogConfig, 30 * 60 * 1000); // 30 minutes in milliseconds
    const interval3 = setInterval(fetchAndLogConfigCWL, 33 * 60 * 1000); // 30 minutes in milliseconds
})


//Intiazlies the sheets variables
async function connectDB() {
    //console.log("trying");

    try{
        mongoose.set('strictQuery', false);
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
    }
    catch(error){
        console.error(`Error: ${error}`);
    }

}


async function initSheet(){
    serviceAccountAuth = new JWT({
    // env var values here are copied from service account credentials generated by google
    // see "Authentication" section in docs for more info
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    keyFile: process.env.GOOGLE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo(); // loads document properties and worksheets

  
}

async function saveData(){
    try{
      const clan = await coc_client.getCurrentWar(process.env.CLAN_TAG);
      console.log(clan.state);
      if(clan.state == 'inWar' || clan.state == 'warEnded'){
        await checkWar(clan);
        const members = clan.clan.members;
        for(const member of members){
          const attacks = member.attacks;
          for(const attack of attacks){
            var opTh = (await coc_client.getPlayer(attack.defenderTag)).townHallLevel;
            attack.oppoentTownHall = opTh;
          }
          let query = {
              tag: member.tag,
              opponent_clan_tag: clan.opponent.tag,
              timestamp: clan.startTime
          }
          
          let result = await MemberSchema.findOne(query);
          if(result){
              result.attacks = member.attacks;
              await result.save();
              console.log("Updated member in database: " + member.name + " for clan " + clan.opponent.tag);
          }
          else{
            let newMember = new MemberSchema({
              name: member.name,
              tag: member.tag,
              townhall: member.townHallLevel,
              opponent_clan_tag: clan.opponent.tag,
              attacks: member.attacks,
              timestamp: clan.startTime,
            });
            await newMember.save();
            console.log("Added new member to database: " + member.name);
          }
  
     }
      console.log("Data saved");
    }
  }
  catch(error){
    console.error(`Error: ${error}`);
  } 
  
}



  
async function checkWar(clan){
    const query = {
      clan_tag: clan.clan.tag,
      opponent_clan_tag: clan.opponent.tag,
      timestamp: clan.startTime,
    }
      let result = await warSchema.findOne(query);
        //console.log("Here: " + result);
      if(!result){
        let newWar = new warSchema({
          clan_tag: clan.clan.tag,
          opponent_clan_tag: clan.opponent.tag,
          timestamp: clan.startTime,
          lastUpdated: Date.now(),
          state: clan.state,
        });
        await newWar.save();
        console.log("Added new war to database");
      }
      else{
        if(result.state != clan.state){
          const channel = client.channels.cache.get(process.env.BOT_FEED);

          result.state = clan.state;
          channel.send(`The war state for ${clan.clan.name} vs ${clan.opponent.name} has changed to ${clan.state}\n <@979875479425261580> Pls Update The Sheets!`);
        }
        result.lastUpdated = Date.now();
        await result.save();
        console.log("Updated war in database");
      }  
    
}

async function fetchAndLogConfig() {
  const messages = await fetchIdkName();
  fs.readFile('config.json', 'utf8', async(err, data) => {
      if (err) {
          console.error('Error reading config.json:', err);
          return;
      }
          let globalIndex = -1;
          const configObject = JSON.parse(data);
          //console.log("Length: " + configObject.IDKchannels.length);
          //console.log('Config:', configObject);
          //console.log(msg);
          for(const channelId of configObject.IDKchannels){
              const channel = client.channels.cache.get(channelId.id);
                const sendMessages = 
                  async() => {
                    while(channelId.messages.length < messages.length){
                      const message = await channel.send("placeholder");
                      channelId.messages.push(message.id);
                    }
                    //console.log(globalIndex);
                    let index = 0;
                    for(const msg of channelId.messages){
                      const message = await channel.messages.fetch(`${msg}`)

                      if(index >= messages.length){
                        await message.edit("");
                      }
                      else{
                        await message.edit(messages[index]);
                      }
                      index++;

                    }
                  }
                  globalIndex++;
                  await sendMessages();
              }
          //console.log(configObject);
          await updateConfig(configObject);
  });
}

async function fetchAndLogConfigCWL() {
  console.log("Fetching and logging config");
  const messages = await fetchCWL();
  fs.readFile('config.json', 'utf8', async(err, data) => {
      if (err) {
          console.error('Error reading config.json:', err);
          return;
      }
          let globalIndex = -1;
          const configObject = JSON.parse(data);
          //console.log("Length: " + configObject.IDKchannels.length);
          //console.log('Config:', configObject);
          //console.log(msg);
          for(const channelId of configObject.CWLchannels){
              const channel = client.channels.cache.get(channelId.id);
                const sendMessages = 
                  async() => {
                    while(channelId.messages.length < messages.length){
                      const message = await channel.send("placeholder");
                      channelId.messages.push(message.id);
                    }
                    //console.log(globalIndex);
                    let index = 0;
                    for(const msg of channelId.messages){
                      const message = await channel.messages.fetch(`${msg}`)

                      if(index >= messages.length){
                        await message.edit("");
                      }
                      else{
                        await message.edit(messages[index]);
                      }
                      index++;

                    }
                  }
                  globalIndex++;
                  await sendMessages();
              }
          //console.log(configObject);
          await updateConfig(configObject);
  });
}

async function updateConfig(updatedConfig){
  fs.writeFile('config.json', JSON.stringify(updatedConfig, null, 2), (err) => {
      if (err) {
          console.error('Error writing config.json:', err);
          return;
      }
      console.log('Config updated');
  });


}

async function fetchCWL(){
  const sheet = doc.sheetsByIndex[5];
  const rows = await sheet.getRows(); // can pass in { limit, offset }
  //console.log(rows.length);

  let scores = [];
  let names = [];
  const nameWidth = 16; // adjust as needed
  const warScoreWidth = 6; // adjust as needed
  const donosScoreWidth = 7; // adjust as needed
  const totalScoreWidth = 8; // adjust as needed
  for (const row of rows) {
      let name = row.get('Name').padEnd(nameWidth, ' ');
      let warScore = parseInt(row.get('Total war score')).toString().padEnd(warScoreWidth, ' ');
      let donosScore = parseInt(row.get('Donos score')).toString().padEnd(donosScoreWidth, ' ');
      let totalScore = row.get('Total score');
      //console.log(totalScore);
      if(!isNaN(parseInt(totalScore))){
          names.push(`${name}${warScore}${donosScore}`);
          //console.log(parseInt(totalScore));
          scores.push(parseInt(totalScore));
      }
  }
  console.log(scores.length);
  console.log(names.length);
  const { sortedScores, sortedNames } = sortScoresAndNames(scores, names);

  //loop through rows
  let arr = [];
  let startStr = "No. Name            War   Dono   Total   \n";
  let message = "```"+startStr;
  let counter = 0;
  for (const row of sortedNames) {
      let formattedScore = sortedScores[counter].toString().padEnd(totalScoreWidth, ' ');
      let rank = (counter + 1).toString().padEnd(4, ' ');
      //console.log(sortedScores[counter]);
      message += rank + row + formattedScore + "\n";
      if(message.length > 1800){
          message += "```";
          arr.push(message);
          message = "```";
      }
      if(counter + 1 == 17)
          message += "-------------------------------------\n";
      counter++;
  }
  if(message.length > 3){
      message += "```";
      arr.push(message);
  }
  //message += "```";
  return arr;
  //await interaction.channel.send(message);
  

}




async function fetchIdkName(){
  const sheet = doc.sheetsByIndex[4];
        const rows = await sheet.getRows(); // can pass in { limit, offset }

        let scores = [];
        let names = [];
        const nameWidth = 16; // adjust as needed
        const warScoreWidth = 6; // adjust as needed
        const donosScoreWidth = 7; // adjust as needed
        const totalScoreWidth = 8; // adjust as needed
        for (const row of rows) {
            let name = row.get('Name').padEnd(nameWidth, ' ');
            let warScore = row.get('Total war score').toString().padEnd(warScoreWidth, ' ');
            let donosScore = row.get('Donos score').toString().padEnd(donosScoreWidth, ' ');
            let totalScore = row.get('Total score');
            //console.log(totalScore);
            if(!isNaN(parseInt(totalScore))){
                names.push(`${name}${warScore}${donosScore}`);
                //console.log(parseInt(totalScore));
                scores.push(parseInt(totalScore));
            }
        }
        //console.log(scores.length);
        //console.log(names.length);
        const { sortedScores, sortedNames } = sortScoresAndNames(scores, names);
  
        //loop through rows
        let arr = [];
        let startStr = "No. Name            War   Dono   Total   \n";
        let message = "```"+startStr;
        let counter = 0;
        for (const row of sortedNames) {
            let formattedScore = sortedScores[counter].toString().padEnd(totalScoreWidth, ' ');
            let rank = (counter + 1).toString().padEnd(4, ' ');
            //console.log(sortedScores[counter]);
            message += rank + row + formattedScore + "\n";
            if(message.length > 1800){
                message += "```";
                arr.push(message);
                message = "```";
            }
            counter++;
        }
        if(message.length > 3){
          message += "```";
          arr.push(message);
        }
        return arr;
        

}




function sortScoresAndNames(scores, names) {
    // Create an array of pairs (score, name)
    let pairedArray = scores.map((score, index) => [score, names[index]]);

    // Sort the paired array based on the score in descending order
    pairedArray.sort((a, b) => b[0] - a[0]);

    // Separate the paired array back into scores and names arrays
    let sortedScores = pairedArray.map(pair => pair[0]);
    let sortedNames = pairedArray.map(pair => pair[1]);

    return { sortedScores, sortedNames };
}
