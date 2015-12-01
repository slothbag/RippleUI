
var app = {

    accounts: [
        {name: "test", address: "rTestXyZ", secret: "sSomeSecret"}
    ],

    contacts: [
        ["test", "rTestXyZ"]
    ],
    
    currencies: ["BTC","AUD","XRP"],
    
    gateways: {},
    
    //var remote;
    // Application Constructor
    initialize: function() {
        this.bindEvents();
    },
    bindEvents: function() {
        document.addEventListener('deviceready', this.onDeviceReady, false);
        //document.addEventListener('resume', this.onResume, false);
    },
    // *********************************************************************************************************
    // *** Initialize
    // *********************************************************************************************************
    onDeviceReady: function() {

        //init db
        app.db = window.openDatabase("rippleui","1.0","RippleUI",1000000);
        app.db.transaction(function(tx){tx.executeSql("CREATE TABLE IF NOT EXISTS SETTINGS (default_account integer, server_ip text)")});
        
        //try get default account
        app.db.transaction(app.dbGetDefaultAcc, app.errorCB);

        
        //loop through and display accounts
        var tmpStr = '<li data-role="list-divider">Accounts</li>';
        for (var a=0;a<app.accounts.length;a++) {
            tmpStr += '<li><a href="#" class="lstChooseAcc" acc_id="'+a+'"><p><strong>'+app.accounts[a].name+'</strong></p> <div class="ripple_address">'+app.accounts[a].address+'</div></a></li>';
            
        }
        $("#lstAccounts").html(tmpStr);
        
        //assign button actions for account lists
        $('[class^=lstChooseAcc]').click( function() {
            var acc_id = $(this).attr('acc_id');
            
            $('#account_lines_list').empty();
            
            app.account = app.accounts[acc_id].address;
            app.accountname = app.accounts[acc_id].name;
            app.secret = app.accounts[acc_id].secret;
            
            app.db.transaction(function(tx){app.dbUpdateDefaultAcc(tx, acc_id)}, app.errorCB);
            
            app.remote.disconnect();
            
            app.account_init = false;
            app.setupRemote();
            
            window.location = "#home";
        });
        $('[id^=lstChooseGW_]').click( function() {
            app.account = $(this).children().next().text();
            app.accountname = $(this).children().first().text();
            app.secret = "";
            $('#account_lines_list').empty();
            
            app.remote.disconnect();
            
            app.account_init = false;
            app.setupRemote();            
            
            window.location = "#home";
        });
        //set up the autocomplete for sendto
        $("#sendto_address").on('input', function(e) {
            var text = $(this).val();
            text = text.toLowerCase();
            if (text.length < 1) {
                $("#sugList").html("");
                $("#sugList").listview("refresh");
            }
            else {
                var tmpStr = "";
                for(var a=0;a<app.contacts.length;a++) {
                    if (app.contacts[a][0].toLowerCase().indexOf(text) != -1)
                        tmpStr = tmpStr + '<li><a href="#" class="contact" contactid="'+a+'">'+app.contacts[a][0]+'</a></li>';
                };
                
                $("#sugList").html(tmpStr);
                $("#sugList").listview("refresh");
                
                $(".contact").click(function() {
                    var contactid = $(this).attr('contactid');
                    $("#sendto_address").val(app.contacts[contactid][1]);
                    $("#sugList").html("");
                    $("#sugList").listview("refresh");
                });
            }
        });
        //setup the tx send button event
        $("#tx_submit").click(function() {
        	//disable the send button
        	$(this).addClass('ui-disabled');
        	$("#tx_cancel").addClass('ui-disabled');
            $("#tx_status").show();
            $("#tx_status").html('Creating transaction');
        	
            var dst = $("#sendto_address").val();
            var amount = $("#amount").val();
            var currency = $("#currency").val();

            setTimeout(app.sendTx(dst, amount, currency), 0);
        });
        //reset the send screen on each visit
        $("#btn_send").click(function() {
        	$("#tx_status").hide();
        	$("#tx_submit").removeClass('ui-disabled');
        	$("#tx_cancel").removeClass('ui-disabled');
        	$("#sendto_address").val("");
        	$("#amount").val("");
        });
        
        app.txn_count = 0;
        
        //init Ripple-lib
        rippled_config = {
            "trusted" : true,
            "websocket_ip" : "s1.ripple.com",
            "websocket_port" : 51233,
            "websocket_ssl" : false,
            "local_signing" : true,
            "trace" : false
        };
        
        //get default account from db
        app.account_init = false;
        
        app.setupRemote();
    },
    
    setupRemote: function() {
        app.remote = ripple.Remote.from_config (rippled_config);
        app.remote.on('ledger_closed', app.handleLedgerClosed);
        app.remote.on('state', app.handleServerConnectionState);
        app.remote.on('connect', app.handleServerConnect);
        app.remote.connect();
        $('#status').html('Connecting');
    },
    
    handleLedgerClosed: function(e) {
        $('#last_ledger').html(e.ledger_index);
        if (e.txn_count)
            app.txn_count += e.txn_count;
        $('#txn_count').html(app.txn_count);
    },
    
    handleServerConnectionState: function(e) {
        if (e == 'online')
            $('#status').html('Connected');
        else
            $('#status').html('Offline');
    },
    
    handleServerConnect: function(e) {
        if (!app.account_init) {
            app.account_init = true;
            
            //Subscribe to events for account
            app.initAccount();
        }
        
        //always update account details on connect
        app.getAccountDetails();
    },
    
    initAccount: function() {
        //subscribe to account
        //console.log('init account');
        
        $('#account_details').text(app.accountname);
        
        if (app.secret == "")
            $("#btn_send").hide();
        else
            $("#btn_send").show();
        
        var accountObj = app.remote.account(app.account);
        app.remote.set_secret(app.account, app.secret);
        
        //set event handlers
        accountObj.on('transaction', app.handleAccountEvent);
        //accountObj.on('entry', app.handleAccountEntry);
    },
    
    getAccountDetails: function() {
        
        //Get trust lines for balances
        app.remote.request_account_lines(app.account)
        .on('success', app.handleAccountLines).request();
        
        //Get XRP balance
        app.remote.request_account_info(app.account)
        .on('success', app.handleAccountInfo).request();
        
        //Get outstanding offers
        app.remote.request_account_offers(app.account, null, true)
        .on('success', app.handleOffers).request();        
        
        //Get last 10 transactions
        var params = {'account':app.account,
            'ledger_index_min': '-1',
            'descending': 'true',
            'limit': '10'};
        app.remote.request_account_tx(params)
        .on('success', app.handleAccountTx).request();
    },
    
    handleAccountEvent: function (e) {

        var txDirection;
        
        if (e.transaction.LimitAmount) {
            navigator.notification.alert("Your trust lines have changed",null,"Trust",null);
        }
        else if (e.transaction.Amount.currency) {
            
            if (e.transaction.Destination == app.account)
                txDirection = 'received';
            else
                txDirection = 'sent';
            
            navigator.notification.alert("You have just "+txDirection+" "+e.transaction.Amount.value+" "+e.transaction.Amount.currency,null,e.transaction.Amount.currency + " balance "+txDirection,null);
            
            app.remote.request_account_lines(app.account).on('success', app.handleAccountLines).request();
        }
        else {
            if (e.transaction.Destination == app.account)
                txDirection = 'received';
            else
                txDirection = 'sent';
            
            navigator.notification.alert("You have just "+txDirection+" "+(e.transaction.Amount/1000000)+" XRP",null,"XRP balance "+txDirection,null);
            
            app.remote.request_account_info(app.account).on('success', app.handleAccountInfo).request();
        }
    },
    
    handleAccountEntry: function (e) {
        console.log('received account entry');
        //console.log(JSON.stringify(e));
    },
    
    handleAccountLines: function (e) {
        //console.log('AccountLines '+JSON.stringify(e));
        var str_balances = '<li data-role="list-divider">Balances</li>';
        //loop through account lines
        var myBalances = {};
        for (var a = 0; a < e.lines.length; a++) {
            var tmpObj = e.lines[a];
            if (tmpObj.currency in myBalances) {
                myBalances[tmpObj.currency] = myBalances[tmpObj.currency] + parseFloat(tmpObj.balance);
            }
            else {
                myBalances[tmpObj.currency] = parseFloat(tmpObj.balance);
            }
        }
        
        $.each(myBalances, function(index, value) {
               if (value >= 0.001 || value <= -0.001 ) {
               str_balances = str_balances + '<li><a href="#transactions" id="lstBalanceRow_'+index+'"><div class="ui-grid-a">';
               str_balances = str_balances + '<div class="ui-block-a" style="width:50%">'+index+'</div>';
               str_balances = str_balances + '<div class="ui-block-b">'+value.toFixed(2)+'</div></div></a></li>';
               }
               });
        $('#account_lines_list').html(str_balances);
        $('#account_lines_list').listview("refresh");
        //$('#btnSend').button().button("refresh");
        
        $('[id^=lstBalanceRow_]').click(function() {
            //app.ws.send('{"command":"account_tx","account":"'+app.account+'","ledger_index_min":0,"limit":10,"descending":true}');
        });
    },

    handleOffers: function (e) {
    	//console.log(JSON.stringify(e));
        var lstOffers = $("#lstOffers");
        lstOffers.empty();
        lstOffers.append('<li data-role="list-divider">Offers</li>');
        
        var tmpObj;
        var tmpStr;
        var taker_gets_issuer;
        var taker_gets_value;
        var taker_gets_currency;
        
        for (var a = 0; a < e.offers.length; a++) {
        	tmpObj = e.offers[a];
        	if (tmpObj.taker_gets.issuer) {
        		taker_gets_issuer = tmpObj.taker_gets.issuer;
        		taker_gets_value = tmpObj.taker_gets.value;
        		taker_gets_currency = tmpObj.taker_gets.currency;
        	}
        	else {
        		taker_gets_issuer = '';
        		taker_gets_value = tmpObj.taker_gets;
        		taker_gets_currency = 'XRP';
        	}
        	tmpStr = '<li>';
        	tmpStr += '<div class="ui-grid-a">';
        	tmpStr += '<div class="ui-block-a" style="width:50%"><div>'+taker_gets_issuer+'</div><div>'+taker_gets_value+' '+taker_gets_currency+'</div></div>';
        	tmpStr += '<div class="ui-block-b">for '+(tmpObj.taker_pays/1000000)+' XRP</div>';
        	tmpStr += '</div></li>';
        	lstOffers.append(tmpStr);
        }
        lstOffers.listview("refresh");
    },
    
    handleAccountInfo: function (e) {
        //console.log('AccountInfo Balance: '+(e.account_data.Balance/100000)+' XRP Seq: '+e.account_data.Sequence);
        $('#xrp_balance').html(Math.floor(e.account_data.Balance / 1000000));
    },
    
    handleAccountTx: function (e) {
        //console.log('Transactions: '+e.transactions.length);
        $('#lstTransactions').empty();
        for (var a = 0; a < e.transactions.length; a++) {
            var tmpObj = e.transactions[a];
            //console.log(tmpObj);
            if (tmpObj.tx.TransactionType == "TrustSet") {
                $('#lstTransactions').append('<li>Trust set: '+tmpObj.tx.LimitAmount.currency+' '+tmpObj.tx.LimitAmount.value+'</li>');
            }
            else if (tmpObj.tx.TransactionType == "OfferCreate") {
                $('#lstTransactions').append('<li>Offer Create: '+tmpObj.tx.TakerGets.currency+' '+tmpObj.tx.TakerGets.value+'</li>');
            }
            else {
                //must be payment
                //first detect direction
   
                var icon_dir;
                if (tmpObj.tx.Destination == app.account)
                    icon_dir = 'l';
                else
                    icon_dir = 'r';
                
                if (tmpObj.tx.Amount.currency)
                    $('#lstTransactions').append('<li><div style="float:left;" class="ui-icon ui-icon-arrow-'+icon_dir+'"></div>&nbsp;'+tmpObj.tx.Amount.currency+' '+tmpObj.tx.Amount.value+'</li>');
                else
                    $('#lstTransactions').append('<li><div style="float:left;" class="ui-icon ui-icon-arrow-'+icon_dir+'"></div>&nbsp;XRP: '+(tmpObj.tx.Amount/1000000)+'</li>');
            }
        }
        //$('#lstTransactions').listview("refresh");
    },
    
    sendTx: function (dst, in_amount, currency) {
        //create delay to allow UI to update
        setTimeout(function() {
            var tx = app.remote.transaction();
            
            var amount = ripple.Amount.from_human(in_amount + " " + currency);
            amount.set_issuer(app.account);
            
            tx.payment(app.account, dst, amount.to_json());
            tx.send_max(amount.value);
            tx.build_path(true);
            
            tx.on('success', function(e) {
            	if (e.engine_result == 'tesSUCCESS')
                	$("#tx_status").html('Payment sent.');
                else
                	$("#tx_status").html('Payment failed.');
                //console.log(JSON.stringify(e));
            })
            tx.on('error', function() {
                $("#tx_status").html('Payment failed.');
            });
            $("#tx_status").html('Sending...');        
            tx.submit();
        }, 50);
    },
    
    dbUpdateDefaultAcc: function(tx, acc_id) {
        //tx.executeSql("CREATE TABLE IF NOT EXISTS SETTINGS (default_account integer, server_ip text)");
        tx.executeSql("UPDATE settings set default_account = "+acc_id+" where exists (select 1 from settings)");
        tx.executeSql("INSERT INTO settings (default_account) select "+acc_id+" where not exists (select 1 from settings)");
        //' end else begin insert into settings (default_account) values ("+acc_id+") end");
        //console.log('saved '+acc_id);
    },
    dbGetDefaultAcc: function(tx) {
        //tx.executeSql("delete from settings");
        tx.executeSql('SELECT default_account FROM settings',[], app.successCB, app.errorCB);
    },
    errorCB: function(err) {
        alert("Error processing SQL: "+err.code);
    },
    successCB: function(tx, results) {
        var acc_id;
        if (results.rows.length == 0)
            acc_id = 0;
        else
            acc_id = results.rows.item(0).default_account;
        
        //console.log('Rows: '+results.rows.length+' acc:'+acc_id);
        
        app.account = app.accounts[acc_id].address;
        app.accountname = app.accounts[acc_id].name;
        app.secret = app.accounts[acc_id].secret;
    }
};
