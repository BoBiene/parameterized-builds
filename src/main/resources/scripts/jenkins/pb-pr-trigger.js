define('jenkins/parameterized-build-pullrequest', [
    'aui/dialog2',
    'jquery',
    'bitbucket/util/server',
    'lodash',
    'aui/flag',
    '@atlassian/clientside-extensions-registry'
], function(
    dialog2,
    $,
    server_util,
    _,
    flag,
    registry
) {
    var allJobs;
    var urlRegex = /(.+?)\/projects\/[\w_ -]+?\/repos\/[\w_ -]+?\/.*/
    var urlParts = window.location.href.match(urlRegex);

    function getResourceUrl(context, resourceType){
        return urlParts[1] + '/rest/parameterized-builds/latest/projects/' + context.project.key + '/repos/'
            + context.repository.slug + '/' + resourceType;
    }

    function getData(resourceUrl){
        return server_util.ajax({
            type: "GET",
            url: resourceUrl,
            dataType: 'json',
        });
    }

    function showManualBuildDialog(buildUrl, branch, jobs) {
        var dialog = dialog2(com.kylenicholls.stash.parameterizedbuilds.jenkins.branchBuild.fullDialog({
            jobs: jobs,
            title: 'Build with Parameters'
        })).show();

        var jobSelector = document.getElementById("job");
        var selectedValue = jobSelector.options[jobSelector.selectedIndex].value;
        setupJobForm(jobs[selectedValue]);

        dialog.$el.find('form').on('submit', function(e) { e.preventDefault(); });
        dialog.$el.find('#start-build').on('click', function() {
            _.defer(function() {
                var $jobParameters = dialog.$el.find('.jenkins-form');
                var jobSelect = document.getElementById("job");
                var id = jobSelector.options[jobSelector.selectedIndex].value;
                var splitBranch = branch.split("/")
                splitBranch.splice(0, 2) //remove ref/heads or ref/tags
                var branchName = splitBranch.join("%2F")
                buildUrl += "/" + jobs[id].id + "/" + encodeURIComponent(branchName) + "?";
                $jobParameters.each(function(index, jobParam) {
                    var $curJobParam = $(jobParam);
                    var key = $curJobParam.find('label').text();
                    var value = dialog.$el.find('#build-param-value-' + index).val();
                    var type = $(dialog.$el.find('#build-param-value-' + index)[0]).attr('class');
                    if (type.indexOf("checkbox") > -1) {
                        value = dialog.$el.find('#build-param-value-' + index)[0].checked;
                    } else if (type.indexOf("hidden") > -1) {
                        value = value.replace('refs/heads/','');
                    }
                    buildUrl += key + "=" + encodeURIComponent(value) + "&";
                });
                triggerBuild(buildUrl.slice(0,-1));
                dialog.hide();
            });
        }).focus().select();
    }

    $(document).on('change', '#job', function(e) {
        e.preventDefault();
        setupJobForm(allJobs[this.value]);
    });

    function setupJobForm(job) {
        var $container = $('.job-params');

        var html = '<div class="job-params">';
        var parameters = job.buildParameters;
        if (parameters) {
            for (i = 0; i < parameters.length; i++) {
                var keyValue = parameters[i];
                for (var key in keyValue){
                    var value = keyValue[key];
                    if (typeof value === "boolean") {
                        html += com.kylenicholls.stash.parameterizedbuilds.jenkins.branchBuild.addBooleanParameter({
                            count: i,
                            key: key,
                            value: value
                        });
                    } else if (typeof value === 'string') {
                        if (value.startsWith('refs/heads/')) {
                            html += com.kylenicholls.stash.parameterizedbuilds.jenkins.branchBuild.addBranchParameter({
                                count: i,
                                key: key,
                                value: value
                            });
                        } else {
                            html += com.kylenicholls.stash.parameterizedbuilds.jenkins.branchBuild.addStringParameter({
                                count: i,
                                key: key,
                                value: value
                            });
                        }
                    } else {
                        html += com.kylenicholls.stash.parameterizedbuilds.jenkins.branchBuild.addArrayParameter({
                            count: i,
                            key: key,
                            value: value
                        });
                    }
                }
            }
        }
        $container.replaceWith(html + "</div>");
    }

    function triggerBuild(buildUrl){
        var successFlag = flag({
            type: 'success',
            body: 'Build started',
            close: 'auto'
        });
        server_util.rest({
            type: "POST",
            url: buildUrl,
            dataType: 'json',
        }).success(function (data) {
            if (data.error){
                successFlag.close();
                flag({
                    type: 'warning',
                    body: data.messageText,
                    close: 'auto'
                });
            } else if (data.prompt) {
                var promptCookie = getCookie("jenkinsPrompt");
                var settingsPath = urlParts[1] + "/plugins/servlet/account/jenkins";
                if (promptCookie !== "ignore") {
                    flag({
                        type: 'info',
                        body: '<p>Optional: <a href="' + settingsPath +
                        '" target="_blank">You can link your Jenkins account to your Bitbucket account.</a></p>' +
                        '<br/><label><input id="prompt-cookie" type="checkbox" /><span>Don\'t show again</span></label>'
                    });
                }
            }
        });
    };

    $(document).on('change', '#prompt-cookie', function(e) {
        var d = new Date();
        d.setTime(d.getTime() + (365*24*60*60*1000));
        var expires = "expires="+ d.toUTCString();
        document.cookie = "jenkinsPrompt=ignore;" + expires + ";path=/";
    });

    function getCookie(cname) {
        var name = cname + "=";
        var ca = document.cookie.split(';');
        for(var i = 0; i <ca.length; i++) {
            var c = ca[i];
            while (c.charAt(0)==' ') {
                c = c.substring(1);
            }
            if (c.indexOf(name) == 0) {
                return c.substring(name.length,c.length);
            }
        }
        return "";
    }

    function buttonPluginFactory(pluginAPI, context) {
        var pullRequest = context.pullRequest;
        var branch = pullRequest.fromRef.id;
        var commit = pullRequest.fromRef.latestCommit;
        var prDest = pullRequest.toRef.displayId;

        var jobsUrl = getResourceUrl(context, "getJobs") + "?branch=" + encodeURIComponent(branch) + "&commit=" + commit + "&prdestination=" + encodeURIComponent(prDest) + "&prid=" + pullRequest.id;
        var hookUrl = getResourceUrl(context, "getHookEnabled");

        function displayManualModal() {
            if (allJobs.length == 1){
                if (allJobs[0].buildParameters.length == 0){
                    var splitBranch = branch.split("/")
                    splitBranch.splice(0, 2) //remove ref/heads or ref/tags
                    var branchName = splitBranch.join("%2F")
                    var buildUrl = getResourceUrl(context, "triggerBuild/0/" + encodeURIComponent(branchName));
                    triggerBuild(buildUrl);
                    return false;
                }
            }
            var buildUrl = getResourceUrl(context, "triggerBuild");
            showManualBuildDialog(buildUrl, branch, allJobs);
            return false;
        }

        $.when(getData(jobsUrl), getData(hookUrl)).then(function( jobs, hookEnabled ) {
            // if the hook is enabled and the user can manually trigger jobs
            if (hookEnabled[0] && jobs[0].length > 0) {
                allJobs = jobs[0];
                // show the button
                pluginAPI.updateAttributes({
                    hidden: false,
                });
            }
        });

        return {
            type: 'button',
            onAction: function onAction() {
                displayManualModal();
            },
            label: 'Build in Jenkins',
            hidden: true
        };
    }

    registry.registerExtension('com.kylenicholls.stash.parameterized-builds:pr-trigger-jenkins', buttonPluginFactory);
});

$(document).ready(function() {
    require('jenkins/parameterized-build-pullrequest');
});