var fs = require('fs');
var path = require('path');
var BaseClass = require('ouro-base');
var chalk = require('chalk');
var _ = require('lodash');
var Case = require('case');

var Promise = require('bluebird');

var gulp = require('gulp');
var rename = require('gulp-rename');
var template = require('gulp-template');
var install = require('gulp-install');
var batchReplace = require('gulp-batch-replace');

//todo: improve current approach to providing different casing for context variables, e.g. perhaps handlebar filters

module.exports = BaseClass.extend({

  init: function(cli) {
    this.cli = cli;
    this.templates = cli.templates;
    this.filemaps = {
      "gitignore": ".gitignore"
    };
  },

  createApp: function(template, name, destination) {

    var self = this;

    console.log(chalk.cyan(':: creating new app:'), chalk.white(name) + chalk.gray(' ('+path.resolve(destination)+')'));

    if( this.templates.get('app', template) ) {

      this.template('app', template)
        .context({appName: name})
        .dest(destination)
        .then(function() {
          if(self.templates.get('app', template).done ) {
            self.templates.get('app', template).done(name, destination);
          }
        });

    } else {
      return false;
    }

  },

  createModule: function(name, destination, callback) {

    console.log(chalk.cyan(':: creating new module:'), chalk.white(name) + chalk.gray(' ('+path.normalize(path.relative(this.cli.reflect.projectRoot(), destination)+'/'+name+'.module.js)')));

    var self = this;

    this.template('module', 'default')
      .options({rename: {name: name}})
      .context({moduleName: this.cli.reflect.getModuleName(destination), name: name, "name.camel": Case.camel(name)})
      .dest(destination)
      .then(function() {

        var parentModulePath = self.cli.reflect.findParentModule(destination);

        self.cli.refactor.addModuleImport({
          identifier: name,
          child: path.resolve(destination + '/' + name+'.module.js'),
          parent: parentModulePath
        });

        self.cli.refactor.addAngularDependency({
          identifier: name,
          module: parentModulePath
        });

        if( callback ) {
          callback.apply(self, []);
        }
      });

  },

  createArtifact: function(type, template, name, destination, callback) {

    var self = this;

    this.template(type, template)
      .options({rename: {name: name}})
      .context({moduleName: this.cli.reflect.getModuleName(destination), name: name, "name_camel": Case.camel(name), "name_title": Case.title(name)})
      .dest(destination)
      .then(function () {

        var identifier = name;
        var parentModulePath = self.cli.reflect.findParentModule(path.resolve(destination));

        //determine whether importing module or specific artifact
        var importType = type;
        if( type === 'component' ) {
          importType = 'module';
        } else if( type === 'directive' && template === 'element' ) {
          importType = 'module';
        }

        var modulePath = path.normalize(path.relative(self.cli.reflect.projectRoot(), destination) + '/' +name +'.'+importType+'.js');
        console.log(chalk.cyan(':: creating new ' + type + ': '), chalk.white(name) + chalk.gray(' (' + modulePath + ')'));

        //add service suffix if not set
        if( type === 'service' ) {
          identifier = Case.pascal(identifier);
          if( identifier.substr(identifier.length-'service'.length, identifier.length) !== 'Service' ) {
            identifier += 'Service';
          }
        }

        self.cli.refactor.addModuleImport({
          identifier: identifier,
          child: path.resolve(destination + '/' + name+'.' + importType + '.js'),
          parent: parentModulePath
        });

        if( importType === 'module' ) {

          self.cli.refactor.addAngularDependency({
            identifier: name,
            module: parentModulePath
          });

        } else {

          self.cli.refactor.addAngularDefinition({
            name: identifier,
            type: type,
            module: parentModulePath
          });

        }

        if(self.templates.get(type, template).done ) {
          self.templates.get(type, template).done(name, destination);
        }

        if( callback ) {
          callback.apply(self, []);
        }
      });

  },

  createTemplate: function(name) {

    var self = this;

    var type = this.cli.reflect.getType(name);
    var template = this.cli.reflect.getTemplate(name);

    var destination = path.resolve(this.cli.reflect.projectRoot() + '/templates/' + type + '/' + template);

    console.log(chalk.cyan(':: creating new template: ' + chalk.white(name)));

    this.template('template', 'default')
      .context({name: name})
      .dest(destination)
      .then(function () {
        //done
      });

  },

  createCommand: function(name) {

    var self = this;

    var destination = path.resolve(this.cli.reflect.projectRoot() + '/commands/' + name);

    console.log(chalk.cyan(':: creating new command: ' + chalk.white(name)));

    this.template('command', 'default')
      .context({name: name})
      .dest(destination)
      .then(function () {
        //done
      });

  },

  template: function(type, templateName) {

    var template = this.templates.get(type, templateName);

    if(template) {

      var templatePath = [];

      if( _.isArray(template.templatePath) ) {
        templatePath = template.templatePath.map(function(path) {
          return path + '/template/**/*';
        });
      } else {
        templatePath.push(template.templatePath  + '/template/**/*');
      }

      return this.source(templatePath);

    } else {

      return false;

    }
  },

  source: function(sourcePath) {

    return {
      cli: this.cli,
      templates: this.templates,
      filemaps: this.filemaps,
      sourcePath: [sourcePath],

      context: this.context,
      options: this.options,
      config: {replace: [], rename: {}},
      dest: this.dest,
      generate: this.generate
    };

  },
  
  context: function(context) {
    this.context = context;
    return this;
  },

  options: function(options) {
    
    this.config = options;

    //make sure we always have at least an empty array
    if( !this.config.replace ) {
      this.config.replace = [];
    }

    //make sure we always have at least an empty array
    if( !this.config.rename ) {
      this.config.rename = {};
    }

    return this;

  },
  
  dest: function(destination) {

    var self = this;
    self.destination = destination;

    return new Promise(function(resolve, reject) {

      if (self.cli.isEnabled('debug')) {
        console.log(chalk.gray(':: source:'), chalk.white(self.sourcePath));
        console.log(chalk.gray(':: destination:'), chalk.white(destination));
      }

      Promise.each(self.sourcePath, function(sourcePath) {
        return self.generate.apply(self, [sourcePath]);
      })
        .then(function() {
          resolve();
        })
        .catch(function(err) {
          reject(err);
        });

    });
  },

  generate: function(sourcePath) {

    var self = this;

    return new Promise(function(resolve, reject) {

      if (self.cli.isEnabled('debug')) {
        console.log(chalk.gray(':: generating template:'), chalk.white(sourcePath));
      }

      var stream = gulp.src(sourcePath, {dot: true})
        .pipe(rename(function (path) {

          var basename = path.basename.split('.');

          //rename special file names (e.g. .gitignore)
          if (self.filemaps[path.basename]) {
            path.basename = self.filemaps[path.basename];
          }

          //rename files based on config
          if( self.config.rename[basename[0]] ) {

            var newName = self.config.rename[basename[0]];

            basename.shift();
            basename.unshift(newName);

            if (self.cli.isEnabled('debug')) {
              console.log(chalk.gray(':: renaming file:'), chalk.white(basename.join('.') + path.extname));
            }

            path.basename = basename.join('.');
          }

        }))
        .pipe(batchReplace(self.config.replace))
        .pipe(template(self.context))
        .pipe(gulp.dest(self.destination));

      stream.on('end', function () {
        resolve({});
      });

      stream.on('error', function (err) {
        reject(err);
      });

    });
  }

});
