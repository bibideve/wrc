/* Verdict — a real, in-browser landing-page scorer.
   It runs entirely client-side so visitors can play before they pay.
   The hero demo grades a headline against the rules a stranger uses in 3 seconds.
   The full 32-point report is the paid product. */

(function () {
  "use strict";

  // Words that weaken a claim (principles 3 & 26).
  var WEAK = ["most","many","some","few","rarely","often","usually","fast","faster",
    "easy","easily","powerful","simple","seamless","robust","cutting-edge","next-gen",
    "best","better","great","amazing","awesome","quality","innovative","smart",
    "effortless","streamline","streamlined","solution","platform","leverage","synergy"];

  var SYL = /[aeiouy]+/g;

  function words(s){ return s.trim().split(/\s+/).filter(Boolean); }

  // Crude syllable count → a stand-in for reading level (principle 7).
  function syllables(w){
    w = w.toLowerCase().replace(/[^a-z]/g,"");
    if(!w) return 0;
    var m = w.match(SYL);
    var n = m ? m.length : 1;
    if(w.length>3 && /e$/.test(w)) n = Math.max(1, n-1); // silent e
    return Math.max(1, n);
  }

  // Each check returns {ok, miss, hit} where miss/hit are the lines we show.
  function grade(text){
    var w = words(text);
    var n = w.length;
    var checks = [];

    // 1. Can be described in under 10 words (principle 30)
    checks.push({
      ok: n > 0 && n <= 10,
      miss: "Your headline is " + n + " words. A stranger reads 10 before deciding. Cut it.",
      hit:  "Tight — " + n + " words. A stranger can finish it before they leave."
    });

    // 2. No weak words (principles 3 & 26)
    var found = w.map(function(x){return x.toLowerCase().replace(/[^a-z-]/g,"");})
                 .filter(function(x){return WEAK.indexOf(x) !== -1;});
    var uniq = found.filter(function(v,i){return found.indexOf(v)===i;});
    checks.push({
      ok: uniq.length === 0,
      miss: "Weak words: " + (uniq.slice(0,3).map(function(x){return '"'+x+'"';}).join(", ")) +
            ". Nobody can picture them. Replace with a claim.",
      hit:  "No filler words. Every word carries weight."
    });

    // 3. Uses a number, not an adjective (principle 3)
    checks.push({
      ok: /\d/.test(text),
      miss: '"Fast" is forgettable. "Save 4 hours a week" isn\'t. Put a number in it.',
      hit:  "It has a number. Numbers stick; adjectives don't."
    });

    // 4. A fifth grader can read it (principle 7)
    var hard = w.filter(function(x){return syllables(x) >= 4;}).length;
    checks.push({
      ok: hard <= 1,
      miss: hard + " words a fifth grader would stumble on. Simple words beat smart ones.",
      hit:  "Plain enough for a fifth grader. Good."
    });

    // 5. Sells an outcome / desire, not a feature (principle 24)
    var DESIRE = /\b(save|earn|win|grow|stop|lose|never|finally|double|cut|fix|escape|free|land|close|ship|sell|book|hours?|days?|money|\$)\b/i;
    checks.push({
      ok: DESIRE.test(text),
      miss: "This describes the tool, not the result. People buy time, money, status or less pain.",
      hit:  "It points at an outcome, not a feature. That's what people buy."
    });

    // 6. Emotional / makes someone react (principle 18) — heuristic: a strong verb or stake
    var EMO = /\b(leak|leaking|broke|broken|dying|hate|love|fear|stuck|alone|secret|nobody|everyone|never|stop|lost|losing|wasting|bleeding)\b/i;
    checks.push({
      ok: EMO.test(text),
      miss: "Flat. People remember feelings, not features. Make them flinch, laugh, or say wow.",
      hit:  "There's a feeling in it. People remember feelings."
    });

    var passed = checks.filter(function(c){return c.ok;}).length;
    // Scale the 6 demo checks onto a /100 score that hints at the full 32.
    var score = Math.round((passed / checks.length) * 100);
    if(n === 0) score = 0;
    return { score: score, checks: checks, passed: passed, total: checks.length };
  }

  function gradeWord(s){
    if(s >= 85) return "Strong. A stranger would keep reading.";
    if(s >= 60) return "Close. A few fixes from converting.";
    if(s >= 35) return "Leaky. Most visitors leave here.";
    return "Cold. Nobody is buying from this.";
  }

  // ---- wire up ----
  var btn = document.getElementById("scan-btn");
  var input = document.getElementById("headline");
  var result = document.getElementById("result");
  var scoreEl = document.getElementById("score");
  var gradeEl = document.getElementById("grade");
  var findings = document.getElementById("findings");
  var locked = document.getElementById("locked-count");

  function run(){
    var text = (input.value || "").trim();
    if(!text){ input.focus(); return; }

    var r = grade(text);

    // animate the number
    result.hidden = false;
    gradeEl.textContent = gradeWord(r.score);
    var start = 0, target = r.score, t0 = performance.now();
    (function tick(now){
      var p = Math.min(1, (now - t0) / 500);
      scoreEl.textContent = Math.round(start + (target - start) * p);
      if(p < 1) requestAnimationFrame(tick);
    })(t0);

    // show the misses first (the painful, useful part), then a couple of hits.
    findings.innerHTML = "";
    var misses = r.checks.filter(function(c){return !c.ok;});
    var hits   = r.checks.filter(function(c){return c.ok;});
    var show = misses.slice(0,3);

    show.forEach(function(c){
      var li = document.createElement("li");
      li.className = "miss";
      li.innerHTML = '<span class="pill">FIX</span><span>' + c.miss + '</span>';
      findings.appendChild(li);
    });
    if(misses.length === 0){
      hits.slice(0,2).forEach(function(c){
        var li = document.createElement("li");
        li.className = "hit";
        li.innerHTML = '<span class="pill">OK</span><span>' + c.hit + '</span>';
        findings.appendChild(li);
      });
    }

    // The hard paywall: we found more, but the rest is paid (principles 8 & 25).
    var hiddenCount = (32 - r.passed) - show.length;
    if(hiddenCount < 0) hiddenCount = 0;
    if(misses.length === 0){
      locked.textContent = "Your headline passes all 6 free checks. 26 more rules check your hero, pricing, proof and footer.";
    } else if(misses.length > 3){
      locked.textContent = "+" + (misses.length - 3) + " more problems in this headline, and 26 rules we haven't run yet.";
    } else {
      locked.textContent = "That's the headline. 26 more rules check your hero, pricing, proof and footer.";
    }

    result.scrollIntoView({behavior:"smooth", block:"nearest"});
  }

  if(btn) btn.addEventListener("click", run);
  if(input) input.addEventListener("keydown", function(e){
    if((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
  });

  // Share button — finish strong, make it easy to pass on (principle 4).
  var share = document.getElementById("share-btn");
  if(share) share.addEventListener("click", function(e){
    e.preventDefault();
    var url = location.href.split("#")[0];
    var text = "Your landing page is leaking money. Verdict shows you where:";
    if(navigator.share){
      navigator.share({title:"Verdict", text:text, url:url}).catch(function(){});
    } else {
      var t = "https://twitter.com/intent/tweet?text=" +
        encodeURIComponent(text) + "&url=" + encodeURIComponent(url);
      window.open(t, "_blank", "noopener");
    }
  });

  // Founder "video" placeholder jumps to the live demo (show, don't tell).
  var face = document.querySelector(".founder-face");
  if(face) face.addEventListener("click", function(){
    document.getElementById("scan").scrollIntoView({behavior:"smooth"});
    input.focus();
  });
})();
