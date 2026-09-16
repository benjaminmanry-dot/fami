(function () {
  var navButton = document.querySelector('[data-nav-toggle]');
  var nav = document.querySelector('[data-main-nav]');

  if (navButton && nav) {
    navButton.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      navButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  var params = new URLSearchParams(window.location.search);
  var campaign = params.get('campaign');
  var campaignField = document.querySelector('#campaign-interest');

  function setHiddenField(name, value) {
    var field = document.querySelector('input[type="hidden"][name="' + name + '"]');
    if (field) {
      field.value = value || '';
    }
  }

  function captureAttribution() {
    setHiddenField('source', params.get('source'));
    setHiddenField('campaign', campaign);
    setHiddenField('utm_source', params.get('utm_source'));
    setHiddenField('utm_medium', params.get('utm_medium'));
    setHiddenField('utm_campaign', params.get('utm_campaign'));
    setHiddenField('utm_content', params.get('utm_content'));
    setHiddenField('landing_page', window.location.href);
    setHiddenField('referrer', document.referrer);
  }

  captureAttribution();

  var sessionZeroForm = document.querySelector('form[name="session-zero"]');
  if (sessionZeroForm) {
    sessionZeroForm.addEventListener('submit', captureAttribution);
  }

  if (campaign && campaignField) {
    var aliasMap = {
      drakkenheim: 'witchlight-tuesday',
      'drakkenheim-tuesday': 'witchlight-tuesday',
      witchlight: 'witchlight-tuesday',
      'epic-quests': 'epic-quests-sunday',
      waterdeep: 'waterdeep-dragonheist-dotmm'
    };
    var retiredCampaigns = {
      'city-of-shade': true,
      'drakkenheim-friday': true,
      'eberron-black-lanterns': true,
      'fortune-wheel': true,
      'keep-on-the-borderlands': true,
      'out-of-the-abyss': true
    };
    var normalized = campaign.toLowerCase();

    if (retiredCampaigns[normalized]) {
      window.location.replace('/campaigns/');
      return;
    }

    if (aliasMap[normalized]) {
      normalized = aliasMap[normalized];
    }

    for (var i = 0; i < campaignField.options.length; i += 1) {
      var opt = campaignField.options[i];
      if (opt.value.toLowerCase() === normalized) {
        campaignField.value = opt.value;
        break;
      }
    }
  }
})();
